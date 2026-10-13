import ExpoModulesCore

// Thin Expo bridge; the model logic lives in OnDeviceLlmEngine.swift.
public class OnDeviceLlmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnDeviceLlm")

    AsyncFunction("getStatus") { () -> [String: String] in
      return OnDeviceLlmEngine.status()
    }

    // The system manages the Apple Intelligence model download; nothing to start.
    AsyncFunction("prepare") { () -> [String: String] in
      return OnDeviceLlmEngine.status()
    }

    AsyncFunction("generatePlan") { (instructions: String, prompt: String) async throws -> String in
      return try await OnDeviceLlmEngine.generatePlan(instructions: instructions, prompt: prompt)
    }
  }
}
