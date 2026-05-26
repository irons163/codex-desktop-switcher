// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CodexAccountSwitcher",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "CodexAccountSwitcherCore",
            targets: ["CodexAccountSwitcherCore"]
        ),
        .executable(
            name: "CodexAccountSwitcher",
            targets: ["CodexAccountSwitcher"]
        )
    ],
    targets: [
        .target(
            name: "CodexAccountSwitcherCore"
        ),
        .executableTarget(
            name: "CodexAccountSwitcher",
            dependencies: ["CodexAccountSwitcherCore"],
            resources: [
                .copy("Resources")
            ]
        ),
        .testTarget(
            name: "CodexAccountSwitcherCoreTests",
            dependencies: ["CodexAccountSwitcherCore"]
        )
    ]
)
