import Foundation
import AVFoundation
import UIKit

/// Konfigurerar native iOS-kameran med kontinuerlig autofokus,
/// kontinuerlig automatisk exponering och kontinuerlig automatisk
/// vitbalans — direkt efter att AVCaptureSession startar och igen
/// varje gång appen comes back till förgrunden efter bakgrundsbyte.
///
/// Skapas via `CameraConfigurator.shared` i AppDelegate.
@objc class CameraConfigurator: NSObject {

    @objc static let shared = CameraConfigurator()

    private override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sessionDidStartRunning(_:)),
            name: .AVCaptureSessionDidStartRunning,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Notifieringshanterare

    @objc private func sessionDidStartRunning(_ notification: Notification) {
        guard let session = notification.object as? AVCaptureSession else { return }
        configureCameraDevice(in: session)
    }

    @objc private func appDidBecomeActive() {
        // Ge sessionen 300 ms att återuppta sig innan vi låser enheten.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.configureBackCamera()
        }
    }

    // MARK: - Konfiguration

    /// Konfigurerar alla videoinputar i en aktiv session.
    private func configureCameraDevice(in session: AVCaptureSession) {
        let videoInputs = session.inputs
            .compactMap { $0 as? AVCaptureDeviceInput }
            .filter { $0.device.hasMediaType(.video) }
        for input in videoInputs {
            configure(input.device)
        }
    }

    /// Konfigurerar den bakre vidvinkelkameran direkt (vid bakgrunds-/förgrundsbyte
    /// är det lättare att slå upp enheten än att hitta den aktiva sessionen).
    private func configureBackCamera() {
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInWideAngleCamera,
            .builtInDualCamera,
            .builtInTripleCamera
        ]
        for type in types {
            if let device = AVCaptureDevice.default(type, for: .video, position: .back) {
                configure(device)
                break
            }
        }
    }

    /// Applicerar kontinuerlig autofokus, exponering och vitbalans med
    /// fokus-/exponeringspunkt satt till kamerans centrum.
    private func configure(_ device: AVCaptureDevice) {
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }

            // Kontinuerlig autofokus
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isFocusPointOfInterestSupported {
                device.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }

            // Kontinuerlig automatisk exponering
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            if device.isExposurePointOfInterestSupported {
                device.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5)
            }

            // Kontinuerlig automatisk vitbalans
            if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                device.whiteBalanceMode = .continuousAutoWhiteBalance
            }

        } catch {
            print("[Vindkollen] CameraConfigurator: lockForConfiguration misslyckades: \(error)")
        }
    }
}
