use std::path::{Path, PathBuf};
use std::process::Command;

use crate::multi::config::GitSyncMode;
use crate::revisions::git;

pub fn keys_dir(server_root: &Path) -> PathBuf {
    server_root.join("git-keys")
}

pub fn key_path(server_root: &Path, space_id: &str) -> PathBuf {
    keys_dir(server_root).join(space_id)
}

pub fn known_hosts_path(server_root: &Path) -> PathBuf {
    keys_dir(server_root).join("known_hosts")
}

fn null_path() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "'\"'\"'"))
}

pub fn ssh_command(key: &Path, known_hosts: &Path) -> String {
    format!(
        "ssh -F {} -i {} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={} -o GlobalKnownHostsFile={} -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no",
        null_path(), shell_quote(key), shell_quote(known_hosts), null_path()
    )
}

pub fn generate(server_root: &Path, space_id: &str) -> Result<String, String> {
    let dir = keys_dir(server_root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create key directory: {e}"))?;
    let path = key_path(server_root, space_id);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}.pub", path.display()));

    let out = Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C"])
        .arg(format!("silverbullet-{space_id}"))
        .arg("-f")
        .arg(&path)
        .output()
        .map_err(|e| format!("cannot run ssh-keygen: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("cannot tighten key permissions: {e}"))?;
    }

    public_key(server_root, space_id).ok_or_else(|| "key generated but not readable".to_string())
}

pub fn public_key(server_root: &Path, space_id: &str) -> Option<String> {
    let path = key_path(server_root, space_id);
    let pub_path = PathBuf::from(format!("{}.pub", path.display()));
    std::fs::read_to_string(pub_path)
        .ok()
        .map(|s| s.trim().to_string())
}

pub fn delete(server_root: &Path, space_id: &str) -> Result<(), String> {
    let path = key_path(server_root, space_id);
    let pub_path = PathBuf::from(format!("{}.pub", path.display()));
    for p in [path, pub_path] {
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| format!("cannot remove {}: {e}", p.display()))?;
        }
    }
    Ok(())
}

pub fn envs(server_root: &Path, space_id: &str) -> Vec<(String, String)> {
    let key = key_path(server_root, space_id);
    if !key.exists() {
        return Vec::new();
    }
    vec![(
        "GIT_SSH_COMMAND".to_string(),
        ssh_command(&key, &known_hosts_path(server_root)),
    )]
}

pub fn fingerprint(server_root: &Path, space_id: &str) -> Option<String> {
    let path = key_path(server_root, space_id);
    let pub_path = PathBuf::from(format!("{}.pub", path.display()));
    let out = Command::new("ssh-keygen")
        .arg("-lf")
        .arg(&pub_path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .nth(1)
        .map(|s| s.to_string())
}

/// Options for the server's own credentials — never prompt, never hang. It
/// deliberately does **not** constrain identity: ssh still reads the server
/// user's `~/.ssh/config`, its default key files and its agent, which is the
/// whole point of manual mode. Skipped entirely when the operator already set
/// `GIT_SSH_COMMAND` or `core.sshCommand`: unlike key mode, which pins its own
/// `UserKnownHostsFile`, there is no host key file here to make a wider
/// override safe.
pub fn ambient_envs(repo: &Path) -> Vec<(String, String)> {
    if std::env::var_os("GIT_SSH_COMMAND").is_some() {
        return Vec::new();
    }
    if git::check(repo, &["config", "--get", "core.sshCommand"], 1).unwrap_or(false) {
        return Vec::new();
    }
    vec![(
        "GIT_SSH_COMMAND".to_string(),
        "ssh -o BatchMode=yes -o ConnectTimeout=10".to_string(),
    )]
}

pub fn is_ssh_url(url: &str) -> bool {
    if let Some(destination) = url.strip_prefix("ssh://") {
        return !destination.is_empty()
            && !destination.starts_with('-')
            && !url.chars().any(char::is_whitespace);
    }
    !url.contains("://")
        && !url.starts_with('-')
        && !url.chars().any(char::is_whitespace)
        && url.split_once(':').is_some_and(|(host, path)| {
            !(host.is_empty()
                || host.contains(['/', '\\'])
                || host == "."
                || path.is_empty()
                || (host.len() == 1 && path.starts_with(['/', '\\'])))
        })
}

pub fn is_unsafe_url(url: &str) -> bool {
    url.is_empty()
        || url.starts_with('-')
        || url.contains(['\n', '\r'])
        || url.split_once("::").is_some_and(|(prefix, _)| {
            prefix
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        })
}

pub fn checked_destination(
    repo: &Path,
    mode: GitSyncMode,
) -> Result<String, crate::revisions::sync::SyncError> {
    use crate::revisions::sync::{self, SyncError};
    let target = sync::resolve_target(repo)?;
    let urls = git::run(repo, &["remote", "get-url", "--all", &target.remote], &[])
        .map_err(|_| SyncError::NoRemote)?;
    let push = git::run(
        repo,
        &["remote", "get-url", "--push", "--all", &target.remote],
        &[],
    )
    .map_err(|_| SyncError::NoRemote)?;
    let raw = git::run(
        repo,
        &[
            "config",
            "--get-all",
            &format!("remote.{}.url", target.remote),
        ],
        &[],
    )
    .map_err(|_| SyncError::NoRemote)?;
    let url = urls.trim();
    if urls.lines().count() != 1
        || push.lines().count() != 1
        || raw.lines().count() != 1
        || push.trim() != url
        || raw.trim() != url
        || git::run(
            repo,
            &[
                "config",
                "--get-regexp",
                "^url\\..*\\.(insteadof|pushinsteadof)$",
            ],
            &[],
        )
        .is_ok()
        || is_unsafe_url(url)
        || (mode == GitSyncMode::Key && !is_ssh_url(url))
    {
        return Err(SyncError::UnsafeTransport);
    }
    Ok(url.to_string())
}

fn identity(
    repo: &Path,
    destination: &str,
    key: &[u8],
) -> Result<String, crate::revisions::sync::SyncError> {
    use sha2::{Digest, Sha256};
    let branch = git::run(repo, &["symbolic-ref", "--short", "HEAD"], &[])
        .map_err(|_| crate::revisions::sync::SyncError::DetachedHead)?;
    let mapping =
        git::run(repo, &["config", "--get-regexp", "^branch\\."], &[]).unwrap_or_default();
    let mut hash = Sha256::new();
    for bytes in [
        destination.as_bytes(),
        branch.as_bytes(),
        mapping.as_bytes(),
        key,
    ] {
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn connection_identity(
    repo: &Path,
    root: &Path,
    id: &str,
    mode: GitSyncMode,
) -> Result<String, crate::revisions::sync::SyncError> {
    let destination = checked_destination(repo, mode)?;
    let key = if mode == GitSyncMode::Key {
        std::fs::read(key_path(root, id))
            .map_err(|_| crate::revisions::sync::SyncError::MissingManagedKey)?
    } else {
        Vec::new()
    };
    identity(repo, &destination, &key)
}

pub fn checked_envs_for_mode(
    mode: GitSyncMode,
    root: &Path,
    id: &str,
    repo: &Path,
) -> Result<Vec<(String, String)>, crate::revisions::sync::SyncError> {
    use crate::revisions::sync::SyncError;
    let key_bytes = if mode == GitSyncMode::Key {
        let key = std::fs::read(key_path(root, id)).map_err(|_| SyncError::MissingManagedKey)?;
        if key.is_empty() {
            return Err(SyncError::MissingManagedKey);
        }
        key
    } else {
        Vec::new()
    };
    let destination = checked_destination(repo, mode)?;
    if let Ok(accepted) =
        std::fs::read_to_string(root.join("git-connections").join(format!("{id}.identity")))
    {
        if accepted != identity(repo, &destination, &key_bytes)? {
            return Err(SyncError::UnsafeTransport);
        }
    }
    if mode != GitSyncMode::Key {
        return Ok(ambient_envs(repo));
    }
    use sha2::{Digest, Sha256};
    let mut result = envs(root, id);
    result.extend([
        ("SB_MANAGED_DESTINATION".into(), destination),
        (
            "SB_MANAGED_KEY".into(),
            key_path(root, id).to_string_lossy().into_owned(),
        ),
        (
            "SB_MANAGED_KEY_HASH".into(),
            format!("{:x}", Sha256::digest(&key_bytes)),
        ),
        (
            "SB_MANAGED_KNOWN_HOSTS".into(),
            known_hosts_path(root).to_string_lossy().into_owned(),
        ),
    ]);
    result.extend([
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_GLOBAL".into(), null_path().into()),
        ("GIT_CONFIG_COUNT".into(), "0".into()),
        ("GIT_ALLOW_PROTOCOL".into(), "ssh".into()),
        ("GIT_SSH_VARIANT".into(), "ssh".into()),
        ("SSH_AUTH_SOCK".into(), String::new()),
    ]);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_transport_blocks_missing_key_and_non_ssh_destinations() {
        let root = tempfile::TempDir::new().unwrap();
        let repo = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q"], &[]).unwrap();
        git::run(
            repo.path(),
            &["remote", "add", "origin", "git@example.test:notes.git"],
            &[],
        )
        .unwrap();
        assert!(
            checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path()).is_err()
        );
        generate(root.path(), "sample").unwrap();
        assert!(
            checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path()).is_ok()
        );
        for url in [
            "https://example.test/notes.git",
            "file:///tmp/notes",
            "/tmp/notes",
            "../notes",
            "C:/notes",
            r"C:\notes",
        ] {
            git::run(repo.path(), &["remote", "set-url", "origin", url], &[]).unwrap();
            assert!(
                checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path())
                    .is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn managed_transport_rejects_hidden_destinations_and_isolates_ssh() {
        let root = tempfile::TempDir::new().unwrap();
        let repo = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q"], &[]).unwrap();
        git::run(
            repo.path(),
            &["remote", "add", "origin", "git@example.test:notes.git"],
            &[],
        )
        .unwrap();
        generate(root.path(), "sample").unwrap();
        let envs =
            checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path()).unwrap();
        let cmd = &envs.iter().find(|(k, _)| k == "GIT_SSH_COMMAND").unwrap().1;
        assert!(cmd.contains(&format!("-F {}", null_path())));
        assert!(cmd.contains("IdentityAgent=none"));
        git::run(
            repo.path(),
            &[
                "config",
                "remote.origin.pushurl",
                "git@other.test:notes.git",
            ],
            &[],
        )
        .unwrap();
        assert!(
            checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path()).is_err()
        );
        git::run(
            repo.path(),
            &["config", "--unset", "remote.origin.pushurl"],
            &[],
        )
        .unwrap();
        git::run(
            repo.path(),
            &[
                "config",
                "url.https://other.test/.insteadOf",
                "git@example.test:",
            ],
            &[],
        )
        .unwrap();
        assert!(
            checked_envs_for_mode(GitSyncMode::Key, root.path(), "sample", repo.path()).is_err()
        );
    }

    #[test]
    fn ssh_command_quotes_paths_so_spaces_survive() {
        let cmd = ssh_command(
            Path::new("/srv/my server/git-keys/abc"),
            Path::new("/srv/my server/git-keys/known_hosts"),
        );
        assert!(
            cmd.contains("-i '/srv/my server/git-keys/abc'"),
            "got: {cmd}"
        );
        assert!(cmd.contains("IdentitiesOnly=yes"));
        assert!(cmd.contains("BatchMode=yes"));
        assert!(cmd.contains("ConnectTimeout=10"));
        assert!(cmd.contains("StrictHostKeyChecking=accept-new"));
    }

    #[test]
    fn envs_is_empty_without_a_generated_key() {
        let root = tempfile::TempDir::new().unwrap();
        assert!(envs(root.path(), "space-1").is_empty());
    }

    #[test]
    fn generated_key_is_private_and_drives_the_ssh_command() {
        let root = tempfile::TempDir::new().unwrap();
        let pubkey = generate(root.path(), "space-1").unwrap();
        assert!(pubkey.starts_with("ssh-ed25519 "), "got: {pubkey}");

        assert_eq!(
            public_key(root.path(), "space-1").as_deref(),
            Some(pubkey.trim())
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(key_path(root.path(), "space-1"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        let envs = envs(root.path(), "space-1");
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].0, "GIT_SSH_COMMAND");
    }

    #[test]
    fn delete_removes_both_halves_of_the_key() {
        let root = tempfile::TempDir::new().unwrap();
        generate(root.path(), "space-1").unwrap();
        delete(root.path(), "space-1").unwrap();
        assert!(envs(root.path(), "space-1").is_empty());
        assert!(public_key(root.path(), "space-1").is_none());
    }

    #[test]
    fn fingerprint_matches_the_generated_key_and_is_absent_without_one() {
        let root = tempfile::TempDir::new().unwrap();
        assert!(fingerprint(root.path(), "space-1").is_none());

        generate(root.path(), "space-1").unwrap();
        let fp = fingerprint(root.path(), "space-1").unwrap();
        assert!(fp.starts_with("SHA256:"), "got: {fp}");

        delete(root.path(), "space-1").unwrap();
        assert!(fingerprint(root.path(), "space-1").is_none());
    }

    #[test]
    fn ambient_envs_hardens_ssh_without_pinning_a_key_or_host_policy() {
        let repo = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q"], &[]).unwrap();

        let envs = ambient_envs(repo.path());
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].0, "GIT_SSH_COMMAND");
        assert!(envs[0].1.contains("BatchMode=yes"));
        assert!(envs[0].1.contains("ConnectTimeout=10"));
        assert!(
            !envs[0].1.contains("-i "),
            "ambient mode must not pin a key: {}",
            envs[0].1
        );
        assert!(!envs[0].1.contains("IdentitiesOnly"));
        assert!(!envs[0].1.contains("StrictHostKeyChecking"));
    }

    #[test]
    fn ambient_envs_defers_to_an_existing_core_ssh_command() {
        let repo = tempfile::TempDir::new().unwrap();
        git::run(repo.path(), &["init", "-q"], &[]).unwrap();
        git::run(
            repo.path(),
            &["config", "core.sshCommand", "ssh -F /custom/config"],
            &[],
        )
        .unwrap();

        assert!(ambient_envs(repo.path()).is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn ssh_process_uses_only_the_managed_identity() {
        let root = tempfile::TempDir::new().unwrap();
        generate(root.path(), "sample").unwrap();
        let command = format!(
            "{} -G git@example.test",
            ssh_command(
                &key_path(root.path(), "sample"),
                &known_hosts_path(root.path())
            )
        );
        let output = Command::new("sh").args(["-c", &command]).output().unwrap();
        assert!(output.status.success());
        let config = String::from_utf8(output.stdout).unwrap();
        let identities: Vec<_> = config
            .lines()
            .filter(|line| line.starts_with("identityfile "))
            .collect();
        assert_eq!(
            identities,
            vec![format!(
                "identityfile {}",
                key_path(root.path(), "sample").display()
            )]
        );
        assert!(config.lines().any(|line| line == "identityagent none"));
        assert!(config.lines().any(|line| line == "identitiesonly yes"));
    }
}
