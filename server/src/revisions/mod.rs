pub mod conflicts;
pub mod engine;
pub mod git;
pub mod keys;
pub mod read;
pub mod store;
pub mod sync;

pub(crate) use engine::{describe_sync_error, redact_credentials};
pub use engine::{Attribution, RevisionEngine, SyncSettings, SyncState, Timing};
pub use git::available as git_available;
pub use read::{
    file_at, file_history, range_file_diff, range_summary, space_log, FileRevisions, LogCommit,
    RangeEnd, RangeFile, RangeSummary, RevisionEntry, SpaceLog,
};
pub use store::{discover_repo_root, RevisionStore};
pub use sync::{classify, resolve_target, RemoteTarget, SyncError};
