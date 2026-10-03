use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

pub(super) fn resolve(
    home: &Path,
    preferred: Option<PathBuf>,
    legacy_override: Option<PathBuf>,
) -> PathBuf {
    preferred
        .or(legacy_override)
        .unwrap_or_else(|| home.join(".liveagent"))
}

// Root links are rejected. Source entry links are copied verbatim, never followed.
pub(super) fn migrate(src: &Path, dst: &Path, marker_name: &str) -> Result<(), String> {
    match fs::symlink_metadata(dst) {
        Ok(info) if !info.is_dir() => {
            return Err(format!(
                "migration destination {} is not a directory",
                dst.display()
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("inspect destination {}: {error}", dst.display())),
    }
    let marker = dst.join(marker_name);
    match fs::symlink_metadata(&marker) {
        Ok(info) if info.is_file() => return Ok(()),
        Ok(_) => {
            return Err(format!(
                "migration marker {} is not a regular file",
                marker.display()
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "inspect migration marker {}: {error}",
                marker.display()
            ))
        }
    }
    let source = match fs::symlink_metadata(src) {
        Ok(info) => info,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "inspect legacy directory {}: {error}",
                src.display()
            ))
        }
    };
    if !source.is_dir() {
        return Err(format!("legacy path {} is not a directory", src.display()));
    }
    fs::create_dir_all(dst).map_err(|error| format!("create {}: {error}", dst.display()))?;
    if !fs::symlink_metadata(dst)
        .map_err(|error| error.to_string())?
        .is_dir()
    {
        return Err(format!(
            "migration destination {} is not a directory",
            dst.display()
        ));
    }
    copy_missing(src, dst)
        .map_err(|error| format!("migrate {} to {}: {error}", src.display(), dst.display()))?;
    publish(&marker, b"complete\n", None)
        .map_err(|error| format!("complete migration {}: {error}", dst.display()))
}

fn copy_missing(src: &Path, dst: &Path) -> io::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let source = entry.path();
        let target = dst.join(entry.file_name());
        let info = fs::symlink_metadata(&source)?;
        match fs::symlink_metadata(&target) {
            Ok(existing) => {
                // symlink_metadata prevents following a user-created destination link.
                if info.is_dir() && existing.is_dir() {
                    copy_missing(&source, &target)?;
                }
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        if info.is_dir() {
            let created = ensure_dir(&target, &info.permissions())?;
            copy_missing(&source, &target)?;
            if created {
                fs::set_permissions(&target, info.permissions())?;
            }
        } else if info.is_file() {
            publish_reader(&target, fs::File::open(&source)?, Some(info.permissions()))?;
        } else if info.file_type().is_symlink() {
            let link = fs::read_link(&source)?;
            create_symlink(&info, &link, &target)?;
        } else {
            return Err(io::Error::other(format!(
                "unsupported legacy file {}",
                source.display()
            )));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn ensure_dir(path: &Path, permissions: &fs::Permissions) -> io::Result<bool> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let mut builder = fs::DirBuilder::new();
    builder.mode(permissions.mode() | 0o700);
    create_migration_dir(builder, path)
}

// Windows has no POSIX permission bits, so the mode of the source entry is dropped here.
#[cfg(not(unix))]
fn ensure_dir(path: &Path, _permissions: &fs::Permissions) -> io::Result<bool> {
    create_migration_dir(fs::DirBuilder::new(), path)
}

// A competing migrator may create this directory. Never follow a competing link.
fn create_migration_dir(builder: fs::DirBuilder, path: &Path) -> io::Result<bool> {
    match builder.create(path) {
        Ok(()) => return Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    if !fs::symlink_metadata(path)?.is_dir() {
        return Err(io::Error::other(format!(
            "migration target {} is not a directory",
            path.display()
        )));
    }
    Ok(false)
}

fn create_symlink(_info: &fs::Metadata, link: &Path, target: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        match std::os::unix::fs::symlink(link, target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        let result = if _info.file_type().is_symlink_dir() {
            std::os::windows::fs::symlink_dir(link, target)
        } else {
            std::os::windows::fs::symlink_file(link, target)
        };
        match result {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn publish(dst: &Path, bytes: &[u8], permissions: Option<fs::Permissions>) -> io::Result<()> {
    publish_reader(dst, bytes, permissions)
}

fn publish_reader<R: Read>(
    dst: &Path,
    mut reader: R,
    permissions: Option<fs::Permissions>,
) -> io::Result<()> {
    let mut temp = tempfile::NamedTempFile::new_in(
        dst.parent()
            .ok_or_else(|| io::Error::other("missing parent"))?,
    )?;
    io::copy(&mut reader, &mut temp)?;
    if let Some(permissions) = permissions {
        temp.as_file().set_permissions(permissions)?;
    }
    temp.as_file().sync_all()?;
    match temp.persist_noclobber(dst) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn roots_share_liveagent_home_and_overrides() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve(root.path(), None, None),
            root.path().join(".liveagent")
        );
        assert_eq!(
            resolve(
                root.path(),
                Some(root.path().join("new")),
                Some(root.path().join("old"))
            ),
            root.path().join("new")
        );
        assert_eq!(
            resolve(root.path(), None, Some(root.path().join("old"))),
            root.path().join("old")
        );
    }

    #[test]
    fn imports_missing_data_without_overwriting_or_replaying_deletions() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("kbrain");
        let new = root.path().join(".liveagent");
        fs::create_dir_all(old.join("sessions")).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("config.json"), "old").unwrap();
        fs::write(new.join("config.json"), "new").unwrap();
        fs::write(old.join("sessions/session.jsonl"), "session").unwrap();
        migrate(&old, &new, ".migration-desktop").unwrap();
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "new");
        assert_eq!(
            fs::read_to_string(new.join("sessions/session.jsonl")).unwrap(),
            "session"
        );
        fs::remove_file(new.join("sessions/session.jsonl")).unwrap();
        migrate(&old, &new, ".migration-desktop").unwrap();
        assert!(!new.join("sessions/session.jsonl").exists());
        assert!(old.join("sessions/session.jsonl").exists());
    }

    #[test]
    fn concurrent_migration_preserves_nested_files_and_modes() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old");
        let new = root.path().join("new");
        for branch in 0..10 {
            let directory = old.join(format!("branch/{branch}/deep"));
            fs::create_dir_all(&directory).unwrap();
            for file in 0..10 {
                let path = directory.join(format!("file-{file}"));
                fs::write(&path, path.to_string_lossy().as_bytes()).unwrap();
            }
        }
        #[cfg(unix)]
        for index in 0..24 {
            std::os::unix::fs::symlink("branch/0/deep/file-0", old.join(format!("link-{index}")))
                .unwrap();
        }
        let barrier = Arc::new(Barrier::new(12));
        let mut handles = Vec::new();
        for _ in 0..12 {
            let old = old.clone();
            let new = new.clone();
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                migrate(&old, &new, ".migration-concurrent")
            }));
        }
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
        for branch in 0..10 {
            for file in 0..10 {
                let relative = format!("branch/{branch}/deep/file-{file}");
                assert_eq!(
                    fs::read(new.join(&relative)).unwrap(),
                    old.join(&relative).to_string_lossy().as_bytes()
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn preserves_permissions_and_symlinks_without_following_destination_links() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old");
        let new = root.path().join("new");
        fs::create_dir_all(old.join("nested")).unwrap();
        let executable = old.join("nested/run.sh");
        fs::write(&executable, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o751)).unwrap();
        let outside = root.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret"), "outside").unwrap();
        fs::create_dir_all(old.join("protected")).unwrap();
        fs::write(old.join("protected/secret"), "should-not-follow").unwrap();
        symlink(&outside, old.join("link")).unwrap();
        symlink("missing-relative", old.join("dangling")).unwrap();
        fs::write(old.join("protected/new"), "must-not-escape").unwrap();
        fs::write(old.join("config.json"), "private").unwrap();
        fs::set_permissions(old.join("config.json"), fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(old.join("nested"), fs::Permissions::from_mode(0o750)).unwrap();
        fs::create_dir_all(&new).unwrap();
        symlink(&outside, new.join("protected")).unwrap();
        migrate(&old, &new, ".migration-symlink").unwrap();
        assert_eq!(
            fs::metadata(new.join("nested/run.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o751
        );
        assert_eq!(fs::read_link(new.join("link")).unwrap(), outside);
        assert_eq!(
            fs::read_link(new.join("dangling")).unwrap(),
            PathBuf::from("missing-relative")
        );
        assert!(!outside.join("new").exists());
        assert_eq!(
            fs::metadata(new.join("config.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(new.join("nested"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o750
        );
        assert_eq!(fs::read_link(new.join("protected")).unwrap(), outside);
        assert_eq!(
            fs::read_to_string(outside.join("secret")).unwrap(),
            "outside"
        );
    }

    #[test]
    fn interrupted_copy_leaves_no_target() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        let error = io::Error::new(io::ErrorKind::Other, "interrupted");
        let reader = FailingReader {
            data: b"partial",
            error,
        };
        assert!(publish_reader(&target, reader, None).is_err());
        assert!(!target.exists());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }

    struct FailingReader {
        data: &'static [u8],
        error: io::Error,
    }

    impl Read for FailingReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.data.is_empty() {
                return Err(io::Error::new(self.error.kind(), self.error.to_string()));
            }
            let size = self.data.len().min(buffer.len());
            buffer[..size].copy_from_slice(&self.data[..size]);
            self.data = &self.data[size..];
            Ok(size)
        }
    }

    #[cfg(unix)]
    #[test]
    fn root_links_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old");
        let new = root.path().join("new");
        fs::create_dir(&old).unwrap();
        std::os::unix::fs::symlink(&old, &new).unwrap();
        assert!(migrate(&old, &new, ".migration").is_err());
        assert!(migrate(&new, &root.path().join("other"), ".migration").is_err());
        assert_eq!(fs::read_dir(&old).unwrap().count(), 0);
    }

    #[test]
    fn failed_and_successful_copies_preserve_existing_files() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("existing");
        fs::write(&target, "user").unwrap();
        publish(&target, b"replacement", None).unwrap();
        assert!(publish_reader(
            &target,
            FailingReader {
                data: b"partial",
                error: io::Error::other("failure")
            },
            None
        )
        .is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "user");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn migration_errors_are_explicit() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old");
        fs::write(&old, "not a directory").unwrap();
        assert!(migrate(&old, &root.path().join("new"), ".migration")
            .unwrap_err()
            .contains("not a directory"));
    }
}
