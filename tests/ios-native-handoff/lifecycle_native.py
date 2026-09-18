#!/usr/bin/env python3
"""Run production Swift lifecycle methods with test doubles (no UIKit rendering).
Requires Swift (provided by the macOS IPA runner). No copied state machine.
This is NOT a device fullscreen/orientation test.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
native = (ROOT / 'BinTV/Player/PhimNativePlayerController.swift').read_text()
web = (ROOT / 'BinTV/Phim/PhimWebView.swift').read_text()


def section(source, start, end):
    return source[source.index(start):source.index(end, source.index(start))]


fields = section(native, '    private var lifecycleIsSuspended', '\n\n    /// Đã báo')
callbacks = section(native, '    func applicationWillResignActive()', '    /// A recreated WKWebView')
transitions = section(native, '    func playerViewController(_ playerViewController:', '    func playerViewControllerShouldAutomaticallyDismiss')
policy = section(web, '    private func livePageNeedsStateRestore(', '    private func rebuildWebView(').replace('private func', 'func')
begin_repair = section(web, '    private func beginForegroundRepair(', '    private func probeLiveWebView(').replace('private func', 'func')

harness = r'''
import Foundation
final class UIApplication {
    enum State { case active, inactive, background }
    static let shared = UIApplication()
    var applicationState = State.active
}
enum PhimDebugLog {
    static func step(_ category: String, _ action: String, _ result: String, _ detail: String = "") {}
}
final class Item {}
final class Player {
    enum Status { case paused, playing, waitingToPlayAtSpecifiedRate }
    var rate: Float = 0 { didSet { mutations += 1 } }
    var timeControlStatus = Status.paused
    var currentItem: Item? = Item()
    var position = 123.5
    var mutations = 0
    func pause() { rate = 0; timeControlStatus = .paused }
    func play() { rate = 1; timeControlStatus = .playing }
}
final class AVPlayerViewController {
    var player: Player?
    var gravity = "resizeAspectFill"
    var controlsVisible = true
    var fullscreen = true
}
struct TransitionContext { var isCancelled = false }
final class UIViewControllerTransitionCoordinator {
    var completion: ((TransitionContext) -> Void)?
    func animate(alongsideTransition: (() -> Void)?, completion: @escaping (TransitionContext) -> Void) {
        self.completion = completion
    }
    func finish() { completion?(TransitionContext()) }
}
struct Request { var session = "session-1" }
final class Native {
    var player: Player? = Player()
    var playerController: AVPlayerViewController? = AVPlayerViewController()
    var request: Request? = Request()
    var shouldPlayWhenReady = true
    var isPresented: Bool { playerController != nil }
    init() { playerController?.player = player }
__FIELDS__
__CALLBACKS__
__TRANSITIONS__
}
var count = 0
func check(_ condition: @autoclosure () -> Bool, _ label: String) {
    precondition(condition(), "FAIL: \(label)")
    count += 1
    print("PASS: \(label)")
}
func cycle(_ subject: Native) {
    UIApplication.shared.applicationState = .inactive
    subject.applicationWillResignActive()
    subject.applicationWillResignActive() // app + scene duplicate
    UIApplication.shared.applicationState = .background
    subject.applicationDidEnterBackground()
    subject.applicationDidBecomeActive() // premature signal must do nothing
    check(subject.player?.rate == 0, "no play until active")
    UIApplication.shared.applicationState = .active
    subject.applicationDidBecomeActive()
    subject.applicationDidBecomeActive() // duplicate must not replay
}
for initialRate: Float in [0, 1, 1.5] {
    let subject = Native()
    let player = subject.player!
    let item = player.currentItem
    let controller = subject.playerController
    player.rate = initialRate
    player.timeControlStatus = initialRate > 0 ? .playing : .paused
    player.mutations = 0
    for _ in 0..<10 { cycle(subject) }
    check(player.rate == initialRate, "preserve pause/play/speed after ten cycles: \(initialRate)")
    check(player.position == 123.5 && player.currentItem === item, "same item and time; no seek/reload")
    check(subject.player === player && subject.playerController === controller, "retain player and fullscreen controller")
    check(controller!.fullscreen && controller!.gravity == "resizeAspectFill" && controller!.controlsVisible,
          "do not mutate fullscreen, gravity or controls")
    if initialRate == 0 { check(player.mutations == 0, "paused player requires zero mutations") }
}
let waiting = Native()
waiting.player!.timeControlStatus = .waitingToPlayAtSpecifiedRate
cycle(waiting)
check(waiting.player!.rate == 1, "waiting-to-play intent survives suspension")
let sceneOnly = Native()
sceneOnly.player!.rate = 1
UIApplication.shared.applicationState = .background
sceneOnly.applicationDidEnterBackground()
UIApplication.shared.applicationState = .active
sceneOnly.applicationDidBecomeActive()
check(sceneOnly.player!.rate == 1, "background fallback without inactive callback")
let stopped = Native()
stopped.player!.rate = 1
stopped.applicationWillResignActive()
stopped.player?.currentItem = nil
stopped.applicationDidBecomeActive()
check(stopped.player!.rate == 0, "do not resume removed item")
// A transition completion captured before Home must not undo a later pause,
// even if it arrives after didBecomeActive (the generation must match).
for entering in [true, false] {
    let subject = Native()
    let coordinator = UIViewControllerTransitionCoordinator()
    subject.player!.rate = 1
    if entering {
        subject.playerViewController(subject.playerController!, willBeginFullScreenPresentationWithAnimationCoordinator: coordinator)
    } else {
        subject.playerViewController(subject.playerController!, willEndFullScreenPresentationWithAnimationCoordinator: coordinator)
    }
    subject.player!.pause() // user pause before Home
    cycle(subject)
    coordinator.finish()
    check(subject.player!.rate == 0, "stale AVKit completion cannot autoplay after Home")
}
final class WebView { var url: URL? = URL(string: "http://127.0.0.1:3000/") }
final class Recovery {
    var savedLifecycleStateJSON: String?
    var contentProcessTerminated = false
    var started = true
    var isApplicationActive = true
    var lifecycleEpoch = 1
    var foregroundRestoreInProgress = false
    var recoveryAttempts = 0
    var queuedRestoreReason: String?
    var webViewGeneration = 1
    var webView = WebView()
    var action = ""
    // No hierarchy API in this double: a detached presenter is not a failure.
    func isLocalPhimPage(_ url: URL) -> Bool { url.host == "127.0.0.1" }
    func rebuildWebView(reason: String) { action = "rebuild" }
    func probeLiveWebView(reason: String, epoch: Int) { action = "probe" }
__POLICY__
__BEGIN_REPAIR__
}
let recovery = Recovery()
recovery.beginForegroundRepair(reason: "detached fullscreen presenter", epoch: 1)
check(recovery.action == "probe", "probe retained page without requiring a window")
let dead = Recovery()
dead.contentProcessTerminated = true
dead.beginForegroundRepair(reason: "process terminated", epoch: 1)
check(dead.action == "rebuild", "confirmed WebContent death still recovers")
let inactive = Recovery()
inactive.isApplicationActive = false
inactive.beginForegroundRepair(reason: "willEnterForeground", epoch: 1)
check(inactive.action.isEmpty, "no recovery while inactive")
recovery.savedLifecycleStateJSON = #"{"browserOpen":true,"player":{"open":true}}"#
check(!recovery.livePageNeedsStateRestore(#"{"browserOpen":false,"playerOpen":true,"api":true}"#),
      "live fullscreen player must not be replayed for hidden browser shell")
check(recovery.livePageNeedsStateRestore(#"{"browserOpen":false,"playerOpen":false,"api":true}"#),
      "actually lost player state still restores")
check(!recovery.livePageNeedsStateRestore(#"{"browserOpen":true,"playerOpen":true,"api":true}"#),
      "healthy page needs no restoration")
print("Swift lifecycle tests: \(count) passed")
'''
for placeholder, value in [('FIELDS', fields), ('CALLBACKS', callbacks), ('TRANSITIONS', transitions),
                           ('POLICY', policy), ('BEGIN_REPAIR', begin_repair)]:
    harness = harness.replace('__' + placeholder + '__', value)
with tempfile.TemporaryDirectory(prefix='bintv-lifecycle-') as directory:
    source = Path(directory) / 'main.swift'
    source.write_text(harness)
    subprocess.run(['swift', str(source)], check=True)
