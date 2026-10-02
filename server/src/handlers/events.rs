//! GET /.events -- Server-Sent Events stream of file-system change events.
//! Auth note: EventSource cannot set headers, so this endpoint must be
//! reachable with cookie auth alone (it sits behind the same protected-route
//! middleware as /.fs).

use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use crate::state::ServerState;

/// Must stay below the clients' 45s realtime-health TTLs, which this is what
/// refreshes on a quiet stream: `realtimeHealthTtlMs` in
/// `client/service_worker/sync_engine.ts` and `REALTIME_HEALTH_TTL` in the
/// App's `src/sync/remote_events.rs`.
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// Ends `stream` the moment `shutdown` fires (or never, if it's `None`) so a
/// live `/.events` connection's response body completes on shutdown instead
/// of running until the client disconnects -- otherwise axum's graceful
/// shutdown, which waits for in-flight connections to finish, hangs on it
/// forever. Hand-rolled rather than `tokio_stream::StreamExt::take_until`
/// (`futures_util`, not a dependency here) or `StreamExt::merge` (which
/// would interleave a shutdown "item" into the SSE body instead of ending
/// it); both the stream and the shutdown future are boxed+pinned, which
/// makes the wrapper itself unconditionally `Unpin` and this `impl` safe
/// without unsafe pin-projection.
struct EndOnShutdown<Item> {
    stream: Pin<Box<dyn Stream<Item = Item> + Send>>,
    shutdown: Pin<Box<dyn Future<Output = ()> + Send>>,
    shutdown_fired: bool,
}

impl<Item> Stream for EndOnShutdown<Item> {
    type Item = Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Item>> {
        let this = self.get_mut();
        if !this.shutdown_fired && this.shutdown.as_mut().poll(cx).is_ready() {
            this.shutdown_fired = true;
        }
        if this.shutdown_fired {
            return Poll::Ready(None);
        }
        this.stream.as_mut().poll_next(cx)
    }
}

/// Emits a named `ping` event whenever `stream` has been idle for
/// `PING_INTERVAL`. A keep-alive comment would do for the wire, but browser
/// `EventSource` never surfaces comments, so a client watching a quiet stream
/// would have no way to tell traffic still flows; a named event is delivered
/// only to `addEventListener("ping")`, leaving `onmessage` consumers (old
/// clients included) untouched. Ends exactly when `stream` ends -- a plain
/// `merge` with an interval stream would never terminate.
struct WithPing {
    stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>,
    interval: tokio::time::Interval,
}

impl Stream for WithPing {
    type Item = Result<Event, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if let Poll::Ready(item) = this.stream.as_mut().poll_next(cx) {
            this.interval.reset();
            return Poll::Ready(item);
        }
        match this.interval.poll_tick(cx) {
            Poll::Ready(_) => Poll::Ready(Some(Ok(Event::default().event("ping").data("{}")))),
            Poll::Pending => Poll::Pending,
        }
    }
}

async fn wait_for_shutdown(mut shutdown: Option<tokio::sync::watch::Receiver<()>>) {
    match &mut shutdown {
        Some(rx) => {
            let _ = rx.changed().await;
        }
        None => std::future::pending::<()>().await,
    }
}

/// A named `sync` event, delivered only to `addEventListener("sync")` --
/// `onmessage` listeners do not receive named sync events.
/// Stripped of `Error`'s message: this endpoint needs only `AccessLevel::Read`,
/// so on a public space the raw git stderr would reach any visitor.
fn sync_event(state: &crate::revisions::SyncState) -> Event {
    let state = state.without_message();
    Event::default()
        .event("sync")
        .data(serde_json::to_string(&state).expect("SyncState serializes"))
}

pub(crate) async fn handle_events(
    State(state): State<Arc<ServerState>>,
    axum::Extension(access): axum::Extension<crate::router::RevisionAccess>,
) -> Response {
    let Some(tx) = &state.fs_events else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let fs_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> = Box::pin(
        BroadcastStream::new(tx.subscribe()).filter_map(
            |item: Result<crate::watcher::FsEvent, BroadcastStreamRecvError>| match item {
                Ok(ev) => Some(Ok::<Event, Infallible>(
                    Event::default().data(serde_json::to_string(&ev).expect("FsEvent serializes")),
                )),
                // Lost events require a full resync, as with watcher flood control.
                Err(BroadcastStreamRecvError::Lagged(_)) => Some(Ok(Event::default().data(
                    serde_json::to_string(&crate::watcher::FsEvent::resync())
                        .expect("FsEvent serializes"),
                ))),
            },
        ),
    );
    // Subscribe before reading the current state, so a transition racing this
    // connection is at worst delivered twice rather than dropped -- and read
    // `last_broadcast_sync_state`, never `sync_state`, which can transiently
    // hold `Syncing` mid-tick.
    let sync_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        match state.revisions.as_ref().filter(|_| access.0) {
            Some(engine) => {
                let engine = engine.clone();
                let rx = engine.subscribe_sync();
                let initial = tokio_stream::once(Ok::<Event, Infallible>(sync_event(
                    &engine.last_broadcast_sync_state(),
                )));
                let updates = BroadcastStream::new(rx).filter_map(
                    move |item: Result<crate::revisions::SyncState, BroadcastStreamRecvError>| {
                        match item {
                            Ok(s) => Some(Ok::<Event, Infallible>(sync_event(&s))),
                            // Lagged: re-derive from the last terminal state
                            // rather than lose the transition silently.
                            Err(BroadcastStreamRecvError::Lagged(_)) => {
                                Some(Ok(sync_event(&engine.last_broadcast_sync_state())))
                            }
                        }
                    },
                );
                Box::pin(initial.chain(updates))
            }
            None => Box::pin(tokio_stream::empty()),
        };
    let stream = fs_stream.merge(sync_stream);
    // Gecko and WebKit wait for a body byte before EventSource.onopen;
    // send a comment now so reconnect catch-up does not wait for a real event.
    let stream =
        tokio_stream::once(Ok::<Event, Infallible>(Event::default().comment("open"))).chain(stream);
    let stream = EndOnShutdown {
        stream: Box::pin(stream),
        shutdown: Box::pin(wait_for_shutdown(state.shutdown.clone())),
        shutdown_fired: false,
    };
    let stream = WithPing {
        stream: Box::pin(stream),
        interval: tokio::time::interval_at(
            tokio::time::Instant::now() + PING_INTERVAL,
            PING_INTERVAL,
        ),
    };
    Sse::new(stream).into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tokio::sync::broadcast;
    use tower::util::ServiceExt;

    use crate::router::build_router;
    use crate::test_support::test_state;
    use crate::watcher::{FsAction, FsEvent};

    #[tokio::test]
    async fn events_endpoint_404s_without_watcher() {
        let state = test_state(); // fs_events: None
        let app = build_router(Arc::new(state));
        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn events_endpoint_streams_events() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel(16);
        state.fs_events = Some(tx.clone());
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            tx.send(FsEvent {
                name: "test.md".to_string(),
                action: FsAction::Change,
                last_modified: 42,
                revision: None,
                origin: None,
            })
            .unwrap();
            drop(tx); // ends the stream so the body can be collected
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("text/event-stream"));
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains(r#""name":"test.md""#), "body was: {text}");
        assert!(text.contains(r#""action":"change""#));
        assert!(text.contains(r#""lastModified":42"#));
    }

    /// The client's `EventSource.onmessage` never sees a named event, so a
    /// conflicted transition must arrive tagged `event: sync` rather than as
    /// an unnamed frame indistinguishable from an `FsEvent`.
    #[tokio::test]
    async fn conflicted_sync_transition_produces_a_named_sync_frame() {
        use tokio_stream::StreamExt as _;

        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let (engine, _dir) = crate::revisions::engine::engine_with_sync_for_test();
        state.revisions = Some(engine.clone());
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let mut frames = resp.into_body().into_data_stream();
        let opening = frames.next().await.unwrap().unwrap();
        assert!(String::from_utf8_lossy(&opening).starts_with(':'));

        // The engine's current state, sent unconditionally as the first sync
        // frame -- see `a_client_connecting_mid_conflict_learns_immediately`
        // for why. Here the engine starts Idle, so this is that frame, not
        // the conflicted transition triggered below.
        let initial = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("no initial sync frame arrived")
            .unwrap()
            .unwrap();
        let initial_text = String::from_utf8_lossy(&initial);
        assert!(
            initial_text.starts_with("event: sync\n"),
            "frame was: {initial_text}"
        );
        assert!(
            initial_text.contains(r#""state":"idle""#),
            "frame was: {initial_text}"
        );

        engine.set_sync_state_for_test(crate::revisions::SyncState::Conflicted {
            paths: vec!["a.md".into()],
        });

        let frame = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("no sync frame arrived")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&frame);
        assert!(text.starts_with("event: sync\n"), "frame was: {text}");
        assert!(
            text.contains(r#""state":"conflicted""#),
            "frame was: {text}"
        );
        assert!(text.contains(r#""a.md""#), "frame was: {text}");
    }

    /// `/.events` needs only `AccessLevel::Read`, so on a public space this
    /// frame reaches an unauthenticated visitor. `Error`'s message is git's
    /// own stderr and must not ride along; `/.revisions/` (Write) keeps it.
    #[tokio::test]
    async fn an_error_sync_frame_carries_the_kind_but_never_the_message() {
        use tokio_stream::StreamExt as _;

        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let (engine, _dir) = crate::revisions::engine::engine_with_sync_for_test();
        engine.set_sync_state_for_test(crate::revisions::SyncState::Error {
            kind: "Other".into(),
            message: "fatal: could not read from 'git.internal.test:notes'".into(),
        });
        state.revisions = Some(engine);
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let mut frames = resp.into_body().into_data_stream();
        let opening = frames.next().await.unwrap().unwrap();
        assert!(String::from_utf8_lossy(&opening).starts_with(':'));

        let frame = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("no sync frame arrived")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&frame);
        assert!(text.starts_with("event: sync\n"), "frame was: {text}");
        assert!(text.contains(r#""kind":"Other""#), "frame was: {text}");
        assert!(!text.contains("message"), "frame was: {text}");
        assert!(!text.contains("git.internal.test"), "frame was: {text}");
    }

    /// Clients connecting during a conflict need the terminal state immediately,
    /// even when no new transition occurs after they subscribe.
    #[tokio::test]
    async fn a_client_connecting_mid_conflict_learns_immediately() {
        use tokio_stream::StreamExt as _;

        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let (engine, _dir) = crate::revisions::engine::engine_with_sync_for_test();
        engine.set_sync_state_for_test(crate::revisions::SyncState::Conflicted {
            paths: vec!["a.md".into()],
        });
        state.revisions = Some(engine);
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let mut frames = resp.into_body().into_data_stream();
        let opening = frames.next().await.unwrap().unwrap();
        assert!(String::from_utf8_lossy(&opening).starts_with(':'));

        let frame = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("no sync frame arrived")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&frame);
        assert!(text.starts_with("event: sync\n"), "frame was: {text}");
        assert!(
            text.contains(r#""state":"conflicted""#),
            "frame was: {text}"
        );
        assert!(text.contains(r#""a.md""#), "frame was: {text}");
    }

    /// The race Finding 1 was about: a tick can be mid-flight (`sync_state`
    /// transiently `Syncing`, `last_broadcast_sync_state` still holding the
    /// previous terminal outcome) at the exact moment a client connects. The
    /// initial frame must reflect the last *terminal* state, not whatever
    /// `sync_state` happens to hold right then -- otherwise this client's
    /// only frame is `Syncing`, and the tick's own `Conflicted` outcome
    /// (unchanged from before) broadcasts nothing to follow it up with.
    #[tokio::test]
    async fn a_client_connecting_mid_tick_still_sees_the_terminal_conflict_not_syncing() {
        use tokio_stream::StreamExt as _;

        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let (engine, _dir) = crate::revisions::engine::engine_with_sync_for_test();
        engine.set_sync_state_for_test(crate::revisions::SyncState::Conflicted {
            paths: vec!["a.md".into()],
        });
        // A tick is in flight: sync_state is Syncing while the last terminal
        // state remains Conflicted.
        engine.set_sync_state_silent_for_test(crate::revisions::SyncState::Syncing);
        state.revisions = Some(engine);
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let mut frames = resp.into_body().into_data_stream();
        let opening = frames.next().await.unwrap().unwrap();
        assert!(String::from_utf8_lossy(&opening).starts_with(':'));

        let frame = tokio::time::timeout(Duration::from_secs(5), frames.next())
            .await
            .expect("no sync frame arrived")
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&frame);
        assert!(text.starts_with("event: sync\n"), "frame was: {text}");
        assert!(
            text.contains(r#""state":"conflicted""#),
            "frame was: {text}, expected the terminal Conflicted, not Syncing"
        );
        assert!(text.contains(r#""a.md""#), "frame was: {text}");
    }

    #[tokio::test]
    async fn lagged_subscriber_gets_resync_instead_of_silent_loss() {
        let mut state = test_state();
        // Small capacity so a burst of sends overflows it before the
        // subscriber (created inside the handler) ever polls.
        let (tx, _keep) = broadcast::channel(2);
        state.fs_events = Some(tx.clone());
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            for i in 0..5 {
                tx.send(FsEvent {
                    name: format!("f{i}.md"),
                    action: FsAction::Change,
                    last_modified: i,
                    revision: None,
                    origin: None,
                })
                .unwrap();
            }
            drop(tx);
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(
            text.contains(r#"{"name":"","action":"resync","lastModified":0}"#),
            "body was: {text}"
        );
    }

    #[tokio::test]
    async fn stream_leads_with_a_comment_so_open_fires_right_away() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx);
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(':'), "body was: {text}");
    }

    /// Browsers cannot observe SSE comments, so a quiet stream must carry a
    /// named event for the client to see that traffic is still flowing.
    #[tokio::test(start_paused = true)]
    async fn quiet_stream_carries_named_ping_events() {
        use tokio_stream::StreamExt as _;

        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        // Held for the whole test: dropping the last sender would end the
        // stream, and this one is about what a *live* but quiet stream sends.
        state.fs_events = Some(tx.clone());
        let app = build_router(Arc::new(state));

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let mut frames = resp.into_body().into_data_stream();
        let opening = frames.next().await.unwrap().unwrap();
        assert!(String::from_utf8_lossy(&opening).starts_with(':'));

        let ping = tokio::time::timeout(Duration::from_secs(60), frames.next())
            .await
            .expect("no ping arrived on an otherwise quiet stream")
            .unwrap()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&ping), "event: ping\ndata: {}\n\n");
        drop(tx);
    }

    /// The browser `EventSource` API cannot set an `Authorization` header, so
    /// this endpoint must be reachable via the session cookie alone (bearer
    /// tokens are not an option here) while still rejecting anonymous access.
    #[tokio::test]
    async fn events_endpoint_requires_cookie_auth() {
        use crate::auth::authenticator::Authenticator;
        use crate::auth::JwtAuthorizer;

        let auth = Arc::new(Authenticator::from_secret_bytes(vec![5u8; 32], "h".into()));
        let token = auth.issue_jwt("alice", 3600).unwrap();
        let authz = JwtAuthorizer::new(auth, "tok".into());

        let mut state = test_state();
        state.authorizer = Some(Arc::new(authz));
        let (tx, _keep) = broadcast::channel(16);
        state.fs_events = Some(tx);
        let state = Arc::new(state);

        let resp = build_router(state.clone())
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // Session cookie alone (no Authorization header, which EventSource
        // cannot set): 200.
        let resp = build_router(state)
            .oneshot(
                Request::get("/.events")
                    .header("host", "localhost")
                    .header("cookie", format!("auth_localhost={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    /// Shutdown must close a quiet SSE stream even while its event senders remain alive.
    #[tokio::test]
    async fn shutdown_signal_ends_an_open_stream() {
        let mut state = test_state();
        let (tx, _keep) = broadcast::channel::<FsEvent>(16);
        state.fs_events = Some(tx.clone());
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(());
        state.shutdown = Some(shutdown_rx);
        let app = build_router(Arc::new(state));

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            shutdown_tx.send(()).unwrap();
            // Keep `tx` and `shutdown_tx`'s sender-ness alive until after the
            // signal fires; dropping `tx` here would end the stream for an
            // unrelated reason (the broadcast channel closing) and the test
            // would no longer be exercising the shutdown path.
            drop(tx);
        });

        let resp = app
            .oneshot(Request::get("/.events").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = tokio::time::timeout(
            Duration::from_secs(5),
            axum::body::to_bytes(resp.into_body(), 1024 * 1024),
        )
        .await
        .expect("stream did not end after shutdown fired -- graceful shutdown would hang")
        .unwrap();
        // No fs events were sent, so the body is just keep-alive comments (or
        // empty) -- the point is that collection completed at all.
        let _ = body;
    }
}
