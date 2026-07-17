import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // MARK: - Appstart

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Lyssna på AVCaptureSession-start för att konfigurera AF/AE/AWB
        // direkt när kameran öppnas av CameraPreview-pluginet.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(captureSessionDidStart(_:)),
            name: .AVCaptureSessionDidStartRunning,
            object: nil
        )
        return true
    }

    // MARK: - Skärmorientering (låst till stående för iPhone)

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        // iPad tillåter alla orientationer; iPhone låses till stående
        // för att förhindra att skärmen roterar under kompasskalibreringen.
        if UIDevice.current.userInterfaceIdiom == .pad {
            return .all
        }
        return .portrait
    }

    // MARK: - Kamerakonfiguration

    /// Anropas när en AVCaptureSession startar (t.ex. när CameraPreview-
    /// pluginet öppnar kameran). Konfigurerar kontinuerlig autofokus,
    /// automatisk exponering och automatisk vitbalans med fokuspunkt i mitten.
    @objc private func captureSessionDidStart(_ notification: Notification) {
        guard let session = notification.object as? AVCaptureSession else { return }
        let videoInputs = session.inputs
            .compactMap { $0 as? AVCaptureDeviceInput }
            .filter { $0.device.hasMediaType(.video) }
        for input in videoInputs {
            applyOptimalCameraSettings(to: input.device)
        }
    }

    /// Applicerar kontinuerlig AF/AE/AWB på en AVCaptureDevice.
    private func applyOptimalCameraSettings(to device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }

            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }
            if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                device.whiteBalanceMode = .continuousAutoWhiteBalance
            }
        } catch {
            print("[Vindkollen] applyOptimalCameraSettings: lockForConfiguration misslyckades: \(error)")
        }
    }

    // MARK: - Livscykel

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Återkonfigurera kameran 300 ms efter att appen kommit tillbaka
        // från bakgrunden — sessionen behöver lite tid att återuppta sig.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.reconfigureBackCamera()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        NotificationCenter.default.removeObserver(self)
    }

    /// Slår upp bakre vidvinkelkameran direkt (enklare än att hitta den
    /// aktiva sessionen vid bakgrunds-/förgrundsbyte).
    private func reconfigureBackCamera() {
        let deviceTypes: [AVCaptureDevice.DeviceType] = [
            .builtInWideAngleCamera,
            .builtInDualCamera,
            .builtInTripleCamera
        ]
        for type in deviceTypes {
            if let device = AVCaptureDevice.default(type, for: .video, position: .back) {
                applyOptimalCameraSettings(to: device)
                break
            }
        }
    }

    // MARK: - URL- och aktivitetshantering

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
