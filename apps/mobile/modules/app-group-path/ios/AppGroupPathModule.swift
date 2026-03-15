import ExpoModulesCore

public class AppGroupPathModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AppGroupPath")

        Function("getContainerPath") { (groupId: String) -> String? in
            return FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: groupId
            )?.path
        }
    }
}
