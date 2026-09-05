use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::Manager;

const MOUSE_RIPPLE_ENABLED_KEY: &str = "mouseRippleEnabled";
const MOUSE_RIPPLE_COLOR_KEY: &str = "mouseRippleColor";
const MOUSE_RIPPLE_SHAPE_KEY: &str = "mouseRippleShape";
const MOUSE_RIPPLE_DURATION_KEY: &str = "mouseRippleDurationMs";
const MOUSE_RIPPLE_SIZE_KEY: &str = "mouseRippleSize";
const MOUSE_RIPPLE_THICKNESS_KEY: &str = "mouseRippleThickness";
const DEFAULT_COLOR: u32 = 0x38BDF8;
const DEFAULT_DURATION_MS: u32 = 620;
const DEFAULT_SIZE: u32 = 168;
const DEFAULT_THICKNESS: u32 = 6;

pub struct MouseEffectsState {
    ripple: Arc<AtomicBool>,
    color: Arc<AtomicU32>,
    shape: Arc<AtomicU32>,
    duration_ms: Arc<AtomicU32>,
    size: Arc<AtomicU32>,
    thickness: Arc<AtomicU32>,
    worker_started: AtomicBool,
}

impl Default for MouseEffectsState {
    fn default() -> Self {
        Self {
            ripple: Arc::new(AtomicBool::new(false)),
            color: Arc::new(AtomicU32::new(DEFAULT_COLOR)),
            shape: Arc::new(AtomicU32::new(0)),
            duration_ms: Arc::new(AtomicU32::new(DEFAULT_DURATION_MS)),
            size: Arc::new(AtomicU32::new(DEFAULT_SIZE)),
            thickness: Arc::new(AtomicU32::new(DEFAULT_THICKNESS)),
            worker_started: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MouseEffectsStatus {
    ripple_enabled: bool,
    color: String,
    shape: &'static str,
    duration_ms: u32,
    size: u32,
    thickness: u32,
}

#[cfg(windows)]
unsafe extern "system" fn overlay_window_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, HTTRANSPARENT, MA_NOACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST,
    };
    match message {
        // 背後の別プロセスを含めてドラッグ・クリック・スクロールを奪わない。
        WM_NCHITTEST => HTTRANSPARENT as isize,
        WM_MOUSEACTIVATE => MA_NOACTIVATE as isize,
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

#[tauri::command]
pub fn mouse_effects_status(state: tauri::State<MouseEffectsState>) -> impl Serialize {
    MouseEffectsStatus {
        ripple_enabled: state.ripple.load(Ordering::Relaxed),
        color: format!("#{:06X}", state.color.load(Ordering::Relaxed)),
        shape: shape_name(state.shape.load(Ordering::Relaxed)),
        duration_ms: state.duration_ms.load(Ordering::Relaxed),
        size: state.size.load(Ordering::Relaxed),
        thickness: state.thickness.load(Ordering::Relaxed),
    }
}

fn parse_color(value: &str) -> Result<u32, String> {
    let hex = value.trim().strip_prefix('#').unwrap_or(value.trim());
    if hex.len() != 6 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("波紋の色は#RRGGBB形式で指定してください".to_string());
    }
    u32::from_str_radix(hex, 16).map_err(|_| "波紋の色を解析できませんでした".to_string())
}

fn parse_shape(value: &str) -> Result<u32, String> {
    match value {
        "circle" => Ok(0),
        "rounded" => Ok(1),
        "square" => Ok(2),
        _ => Err("未対応の波紋形状です".to_string()),
    }
}

fn shape_name(value: u32) -> &'static str {
    match value {
        1 => "rounded",
        2 => "square",
        _ => "circle",
    }
}

#[tauri::command]
pub fn mouse_effects_update(
    state: tauri::State<MouseEffectsState>,
    db_state: tauri::State<crate::storage::DbState>,
    ripple_enabled: bool,
    color: String,
    shape: String,
    duration_ms: u32,
    size: u32,
    thickness: u32,
) -> Result<(), String> {
    let parsed_color = parse_color(&color)?;
    let parsed_shape = parse_shape(&shape)?;
    if !(200..=2000).contains(&duration_ms) {
        return Err("速度は200〜2000ミリ秒の範囲で指定してください".to_string());
    }
    if !(48..=240).contains(&size) {
        return Err("波紋サイズは48〜240ピクセルの範囲で指定してください".to_string());
    }
    if !(2..=16).contains(&thickness) || thickness * 2 >= size {
        return Err("線の太さは2〜16ピクセルの範囲で指定してください".to_string());
    }

    let conn = db_state.0.lock().unwrap();
    crate::storage::settings_set_internal(
        &conn,
        MOUSE_RIPPLE_ENABLED_KEY,
        if ripple_enabled { "true" } else { "false" },
    )?;
    crate::storage::settings_set_internal(
        &conn,
        MOUSE_RIPPLE_COLOR_KEY,
        &format!("#{parsed_color:06X}"),
    )?;
    crate::storage::settings_set_internal(&conn, MOUSE_RIPPLE_SHAPE_KEY, shape_name(parsed_shape))?;
    crate::storage::settings_set_internal(
        &conn,
        MOUSE_RIPPLE_DURATION_KEY,
        &duration_ms.to_string(),
    )?;
    crate::storage::settings_set_internal(&conn, MOUSE_RIPPLE_SIZE_KEY, &size.to_string())?;
    crate::storage::settings_set_internal(
        &conn,
        MOUSE_RIPPLE_THICKNESS_KEY,
        &thickness.to_string(),
    )?;
    drop(conn);
    apply_settings(
        &state,
        ripple_enabled,
        parsed_color,
        parsed_shape,
        duration_ms,
        size,
        thickness,
    );
    Ok(())
}

fn apply_settings(
    state: &MouseEffectsState,
    ripple_enabled: bool,
    color: u32,
    shape: u32,
    duration_ms: u32,
    size: u32,
    thickness: u32,
) {
    state.ripple.store(ripple_enabled, Ordering::Relaxed);
    state.color.store(color, Ordering::Relaxed);
    state.shape.store(shape, Ordering::Relaxed);
    state.duration_ms.store(duration_ms, Ordering::Relaxed);
    state.size.store(size, Ordering::Relaxed);
    state.thickness.store(thickness, Ordering::Relaxed);
    if ripple_enabled && !state.worker_started.swap(true, Ordering::SeqCst) {
        start_mouse_worker(
            state.ripple.clone(),
            state.color.clone(),
            state.shape.clone(),
            state.duration_ms.clone(),
            state.size.clone(),
            state.thickness.clone(),
        );
    }
}

/// SQLiteへ保存された設定を起動時に復元する。無効または未設定なら監視スレッドを
/// 起動しないため、既定状態では追加の常駐処理を持たない。
pub fn restore_saved_setting(app: &tauri::AppHandle) {
    let settings = {
        let db_state = app.state::<crate::storage::DbState>();
        let conn = db_state.0.lock().unwrap();
        let get = |key| crate::storage::settings_get_internal(&conn, key);
        (
            get(MOUSE_RIPPLE_ENABLED_KEY).is_some_and(|value| value == "true"),
            get(MOUSE_RIPPLE_COLOR_KEY)
                .and_then(|value| parse_color(&value).ok())
                .unwrap_or(DEFAULT_COLOR),
            get(MOUSE_RIPPLE_SHAPE_KEY)
                .and_then(|value| parse_shape(&value).ok())
                .unwrap_or(0),
            get(MOUSE_RIPPLE_DURATION_KEY)
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_DURATION_MS)
                .clamp(200, 2000),
            get(MOUSE_RIPPLE_SIZE_KEY)
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_SIZE)
                .clamp(48, 240),
            get(MOUSE_RIPPLE_THICKNESS_KEY)
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_THICKNESS)
                .clamp(2, 16),
        )
    };
    let state = app.state::<MouseEffectsState>();
    apply_settings(
        &state, settings.0, settings.1, settings.2, settings.3, settings.4, settings.5,
    );
}

#[cfg(windows)]
fn start_mouse_worker(
    ripple: Arc<AtomicBool>,
    color: Arc<AtomicU32>,
    shape: Arc<AtomicU32>,
    duration_ms: Arc<AtomicU32>,
    size: Arc<AtomicU32>,
    thickness: Arc<AtomicU32>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_native_overlay(ripple, color, shape, duration_ms, size, thickness) {
            tracing::error!("Windowsクリック波紋の初期化に失敗しました: {error}");
        }
    });
}

#[cfg(windows)]
fn run_native_overlay(
    ripple_enabled: Arc<AtomicBool>,
    color: Arc<AtomicU32>,
    shape: Arc<AtomicU32>,
    duration_ms: Arc<AtomicU32>,
    size: Arc<AtomicU32>,
    thickness: Arc<AtomicU32>,
) -> Result<(), String> {
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{COLORREF, HWND, POINT};
    use windows_sys::Win32::Graphics::Gdi::{
        CombineRgn, CreateEllipticRgn, CreateRectRgn, CreateRoundRectRgn, CreateSolidBrush,
        DeleteObject, InvalidateRect, SetWindowRgn, UpdateWindow, RGN_DIFF,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, GetCursorPos, RegisterClassW, SetClassLongPtrW,
        SetLayeredWindowAttributes, SetWindowPos, ShowWindow, GCLP_HBRBACKGROUND, HWND_TOPMOST,
        LWA_ALPHA, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE, WNDCLASSW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn register_overlay_class(name: &[u16], color: COLORREF) -> Result<(), String> {
        let instance = unsafe { GetModuleHandleW(null()) };
        let class = WNDCLASSW {
            lpfnWndProc: Some(overlay_window_proc),
            hInstance: instance,
            hbrBackground: unsafe { CreateSolidBrush(color) },
            lpszClassName: name.as_ptr(),
            ..Default::default()
        };
        if unsafe { RegisterClassW(&class) } == 0 {
            return Err("波紋用ウィンドウクラスを登録できませんでした".to_string());
        }
        Ok(())
    }

    unsafe fn create_overlay(class_name: &[u16]) -> Result<HWND, String> {
        let instance = unsafe { GetModuleHandleW(null()) };
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class_name.as_ptr(),
                class_name.as_ptr(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                null_mut(),
                null_mut(),
                instance,
                null(),
            )
        };
        if hwnd.is_null() {
            return Err("波紋用ウィンドウを作成できませんでした".to_string());
        }
        if unsafe { SetLayeredWindowAttributes(hwnd, 0, 230, LWA_ALPHA) } == 0 {
            return Err("波紋用ウィンドウを透明化できませんでした".to_string());
        }
        Ok(hwnd)
    }

    fn color_ref(rgb: u32) -> COLORREF {
        let red = (rgb >> 16) & 0xff;
        let green = (rgb >> 8) & 0xff;
        let blue = rgb & 0xff;
        red | (green << 8) | (blue << 16)
    }

    let ripple_class = wide("LocalHubMouseRipple");
    let initial_color = color.load(Ordering::Relaxed);
    unsafe {
        register_overlay_class(&ripple_class, color_ref(initial_color))?;
    }
    let ripple_window = unsafe { create_overlay(&ripple_class)? };
    let mut was_pressed = false;
    let mut ripple_started: Option<(Instant, i32, i32)> = None;
    let mut applied_color = initial_color;

    loop {
        let ripple_on = ripple_enabled.load(Ordering::Relaxed);
        let current_color = color.load(Ordering::Relaxed);
        if current_color != applied_color {
            let brush = unsafe { CreateSolidBrush(color_ref(current_color)) };
            unsafe { SetClassLongPtrW(ripple_window, GCLP_HBRBACKGROUND, brush as isize) };
            applied_color = current_color;
        }
        let mut point = POINT { x: 0, y: 0 };
        let has_cursor = unsafe { GetCursorPos(&mut point) } != 0;
        let pressed = unsafe {
            GetAsyncKeyState(VK_LBUTTON as i32) < 0
                || GetAsyncKeyState(VK_RBUTTON as i32) < 0
                || GetAsyncKeyState(VK_MBUTTON as i32) < 0
        };
        if ripple_on && pressed && !was_pressed && has_cursor {
            ripple_started = Some((Instant::now(), point.x, point.y));
        }
        was_pressed = pressed;

        if let Some((started, x, y)) = ripple_started {
            let duration = duration_ms.load(Ordering::Relaxed).max(1) as f32 / 1000.0;
            let progress = started.elapsed().as_secs_f32() / duration;
            if progress >= 1.0 || !ripple_on {
                unsafe { ShowWindow(ripple_window, SW_HIDE) };
                ripple_started = None;
            } else {
                let max_radius = size.load(Ordering::Relaxed) as i32 / 2;
                let radius = 10 + (progress * (max_radius - 10) as f32) as i32;
                let diameter = radius * 2;
                let line_width = thickness.load(Ordering::Relaxed) as i32;
                let shape = shape.load(Ordering::Relaxed);
                let (outer, inner) = unsafe {
                    match shape {
                        1 => (
                            CreateRoundRectRgn(0, 0, diameter, diameter, radius / 2, radius / 2),
                            CreateRoundRectRgn(
                                line_width,
                                line_width,
                                diameter - line_width,
                                diameter - line_width,
                                radius / 2,
                                radius / 2,
                            ),
                        ),
                        2 => (
                            CreateRectRgn(0, 0, diameter, diameter),
                            CreateRectRgn(
                                line_width,
                                line_width,
                                diameter - line_width,
                                diameter - line_width,
                            ),
                        ),
                        _ => (
                            CreateEllipticRgn(0, 0, diameter, diameter),
                            CreateEllipticRgn(
                                line_width,
                                line_width,
                                diameter - line_width,
                                diameter - line_width,
                            ),
                        ),
                    }
                };
                if !outer.is_null() && !inner.is_null() {
                    unsafe {
                        CombineRgn(outer, outer, inner, RGN_DIFF);
                        DeleteObject(inner);
                        SetWindowRgn(ripple_window, outer, 1);
                        SetLayeredWindowAttributes(
                            ripple_window,
                            0,
                            (230.0 * (1.0 - progress)) as u8,
                            LWA_ALPHA,
                        );
                        SetWindowPos(
                            ripple_window,
                            HWND_TOPMOST,
                            x - radius,
                            y - radius,
                            diameter,
                            diameter,
                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                        );
                        ShowWindow(ripple_window, SW_SHOWNOACTIVATE);
                        InvalidateRect(ripple_window, null(), 1);
                        UpdateWindow(ripple_window);
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(not(windows))]
fn start_mouse_worker(
    _ripple: Arc<AtomicBool>,
    _color: Arc<AtomicU32>,
    _shape: Arc<AtomicU32>,
    _duration_ms: Arc<AtomicU32>,
    _size: Arc<AtomicU32>,
    _thickness: Arc<AtomicU32>,
) {
}
