use std::fs::OpenOptions;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const UI_URL: &str = "http://127.0.0.1:8787";
const UI_HOST: &str = "127.0.0.1:8787";

struct ServerState(Mutex<Option<Child>>);

fn resolve_project_root() -> Option<PathBuf> {
  if let Ok(p) = std::env::var("STUDIO_CONSOLE_ROOT") {
    let pb = PathBuf::from(p);
    if pb.join("studio-pull/ui-server.mjs").is_file() {
      return Some(pb);
    }
  }

  if let Ok(mut cur) = std::env::current_dir() {
    for _ in 0..10 {
      if cur.join("studio-pull/ui-server.mjs").is_file() {
        return Some(cur);
      }
      if !cur.pop() {
        break;
      }
    }
  }

  if let Ok(exe) = std::env::current_exe() {
    let mut cur = exe;
    for _ in 0..12 {
      if cur.join("studio-pull/ui-server.mjs").is_file() {
        return Some(cur);
      }
      if !cur.pop() {
        break;
      }
    }
  }

  None
}

fn resolve_node() -> Option<PathBuf> {
  for candidate in [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/opt/homebrew/opt/node/bin/node",
    "/opt/homebrew/opt/nodejs/bin/node",
    "/opt/homebrew/opt/node.js/bin/node",
  ] {
    let p = PathBuf::from(candidate);
    if p.is_file() {
      return Some(p);
    }
  }

  if let Ok(out) = Command::new("/usr/bin/which").arg("node").output() {
    if out.status.success() {
      let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
      if !s.is_empty() {
        let p = PathBuf::from(&s);
        if p.is_file() {
          return Some(p);
        }
      }
    }
  }

  None
}

fn port_open() -> bool {
  TcpStream::connect_timeout(
    &UI_HOST.parse().expect("static addr"),
    Duration::from_millis(200),
  )
  .is_ok()
}

fn wait_for_port(timeout_ms: u64) -> bool {
  let start = Instant::now();
  while start.elapsed() < Duration::from_millis(timeout_ms) {
    if port_open() {
      return true;
    }
    std::thread::sleep(Duration::from_millis(150));
  }
  false
}

fn log_path() -> PathBuf {
  let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
  PathBuf::from(home)
    .join("Library/Logs")
    .join("StudioConsole.log")
}

fn start_sidecar() -> Result<Option<Child>, String> {
  if port_open() {
    // Already running (e.g. npm run studio-console) — reuse it.
    return Ok(None);
  }

  let root = resolve_project_root().ok_or_else(|| {
    "Nie znaleziono drive-uploader (studio-pull/ui-server.mjs). Ustaw STUDIO_CONSOLE_ROOT.".to_string()
  })?;
  let node = resolve_node().ok_or_else(|| {
    "Nie znaleziono Node.js. Zainstaluj: https://nodejs.org lub brew install node".to_string()
  })?;
  let script = root.join("studio-pull/ui-server.mjs");

  if let Some(parent) = log_path().parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  let log_file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(log_path())
    .map_err(|e| format!("Nie mogę otworzyć logu: {e}"))?;
  let log_err = log_file
    .try_clone()
    .map_err(|e| format!("Nie mogę sklonować logu: {e}"))?;

  let child = Command::new(&node)
    .arg(&script)
    .current_dir(&root)
    .env("STUDIO_CONSOLE_NO_BROWSER", "1")
    .env("STUDIO_CONSOLE_EMBEDDED", "1")
    .stdout(Stdio::from(log_file))
    .stderr(Stdio::from(log_err))
    .spawn()
    .map_err(|e| format!("Nie uruchomiono ui-server: {e}"))?;

  if !wait_for_port(12_000) {
    return Err(
      "Serwer Studio Console nie wystartował na :8787. Sprawdź ~/Library/Logs/StudioConsole.log"
        .into(),
    );
  }

  Ok(Some(child))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(ServerState(Mutex::new(None)))
    .setup(|app| {
      match start_sidecar() {
        Ok(child) => {
          if let Some(child) = child {
            *app.state::<ServerState>().0.lock().unwrap() = Some(child);
          }
        }
        Err(msg) => {
          eprintln!("Studio Console: {msg}");
          let err_html = format!(
            "data:text/html,<html><body style='font-family:system-ui;background:#0f172a;color:#f8fafc;padding:2rem'><h1>Studio Console</h1><p>{}</p><p style='color:#94a3b8'>Log: ~/Library/Logs/StudioConsole.log</p></body></html>",
            html_escape(&msg)
          );
          WebviewWindowBuilder::new(app, "main", WebviewUrl::External(err_html.parse()?))
            .title("Studio Console")
            .inner_size(900.0, 640.0)
            .build()?;
          return Ok(());
        }
      }

      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(UI_URL.parse()?))
        .title("Studio Console")
        .inner_size(1100.0, 820.0)
        .min_inner_size(800.0, 600.0)
        .build()?;

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building Studio Console");

  app.run(|app_handle, event| {
    if let RunEvent::Exit = event {
      if let Some(state) = app_handle.try_state::<ServerState>() {
        if let Ok(mut guard) = state.0.lock() {
          if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
          }
        }
      }
    }
  });
}

fn html_escape(s: &str) -> String {
  s.replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
}
