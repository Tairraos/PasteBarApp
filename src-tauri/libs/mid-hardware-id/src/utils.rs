use crate::MIDError;
use std::{ffi::OsStr, process::Command};

#[macro_export]
macro_rules! debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            println!($($arg)*);
        }
    };
}

// linux.rs calls this helper but it was never written, so the crate never compiled on
// Linux and the vendor import sat unused. Signature matches the only call site:
// run_shell_comand("sh", ["-c", "<script>"]).
#[cfg(target_os = "linux")]
pub(crate) fn run_shell_comand<I, S>(program: &str, args: I) -> Result<String, MIDError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(MIDError::ExecuteProcessError)?;
    String::from_utf8(output.stdout).map_err(MIDError::ParseError)
}
