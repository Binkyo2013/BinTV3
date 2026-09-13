// ci-skip: class AppDelegate da duoc khai bao trong BinTV/App/App.swift
// (invalid redeclaration neu them ca hai vao target BinTV). Giu file lai de mo
// project tren Xcode van con Scene/UI lifecycle tham chieu, nhung KHONG build no.
import UIKit

class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
}
