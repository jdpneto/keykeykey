// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DomainMatcherRunner",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "DomainMatcherRunner",
            path: "Sources/DomainMatcherRunner"
        )
    ]
)
