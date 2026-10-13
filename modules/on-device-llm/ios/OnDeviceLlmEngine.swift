// Apple Foundation Models (iOS 26+) planner. Kept free of ExpoModulesCore so it
// can be typechecked on its own:
//   xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios26.0-simulator OnDeviceLlmEngine.swift
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDeviceLlmError: LocalizedError {
  case unavailable(String)
  case generationFailed(String)

  var errorDescription: String? {
    switch self {
    case .unavailable(let reason):
      return "On-device model unavailable: \(reason)"
    case .generationFailed(let message):
      return "On-device generation failed: \(message)"
    }
  }
}

// Must match ADJUSTMENTS / REGIONS / INTENTS in src/edits/catalog.ts and
// src/edits/schema.ts (enforced by src/nlp/__tests__/onDeviceVocabulary.test.ts).
enum PlanVocabulary {
  // vocabulary:intents
  static let intents = ["edit", "auto-enhance", "undo", "redo", "reset", "unsupported"]
  // vocabulary:adjustments
  static let adjustments = [
    "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks",
    "saturation", "vibrance", "temperature", "tint", "hue", "clarity", "dehaze",
    "sharpen", "blur", "smooth", "vignette", "grain", "fade", "monochrome", "sepia",
  ]
  // vocabulary:regions
  static let regions = [
    "all", "person", "background", "face", "skin", "hair", "clothes", "eyes", "mouth", "sky",
    "shadow-areas", "midtone-areas", "highlight-areas",
    "reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas",
    "top", "bottom", "left", "right", "center", "edges",
  ]
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct GeneratedStep: Codable {
  @Guide(description: "Adjustment to apply", .anyOf(PlanVocabulary.adjustments))
  var adjustment: String

  @Guide(description: "Region (mask) the adjustment applies to", .anyOf(PlanVocabulary.regions))
  var region: String

  @Guide(description: "Strength; negative = less/darker/cooler, positive = more/brighter/warmer", .range(-1.0...1.0))
  var amount: Double

  @Guide(description: "true selects everything except the region")
  var invert: Bool
}

@available(iOS 26.0, *)
@Generable
struct GeneratedPlan: Codable {
  @Guide(description: "What the user wants", .anyOf(PlanVocabulary.intents))
  var intent: String

  @Guide(description: "Adjustment steps in order; empty unless intent is edit", .maximumCount(8))
  var steps: [GeneratedStep]

  @Guide(description: "One short friendly sentence describing what was done")
  var reply: String
}
#endif

enum OnDeviceLlmEngine {
  /// { status: available | downloadable | downloading | unavailable, reason }
  static func status() -> [String: String] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return ["status": "available", "reason": ""]
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
          return ["status": "unavailable", "reason": "deviceNotEligible"]
        case .appleIntelligenceNotEnabled:
          return ["status": "unavailable", "reason": "appleIntelligenceNotEnabled"]
        case .modelNotReady:
          // Apple downloads the model assets in the background.
          return ["status": "downloading", "reason": "modelNotReady"]
        @unknown default:
          return ["status": "unavailable", "reason": "unknown"]
        }
      }
    }
    #endif
    return ["status": "unavailable", "reason": "requiresIOS26"]
  }

  static func generatePlan(instructions: String, prompt: String) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      guard case .available = SystemLanguageModel.default.availability else {
        throw OnDeviceLlmError.unavailable(status()["reason"] ?? "unknown")
      }
      let session = LanguageModelSession(instructions: instructions)
      let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 400)
      do {
        let response = try await session.respond(
          to: prompt,
          generating: GeneratedPlan.self,
          includeSchemaInPrompt: true,
          options: options
        )
        let data = try JSONEncoder().encode(response.content)
        return String(decoding: data, as: UTF8.self)
      } catch let error as LanguageModelSession.GenerationError {
        throw OnDeviceLlmError.generationFailed(String(describing: error))
      } catch {
        // Errors crossing the model's XPC boundary can arrive as bridged NSErrors
        // that don't match the typed catch above; keep domain/code for diagnosis.
        let ns = error as NSError
        throw OnDeviceLlmError.generationFailed("\(ns.domain) \(ns.code): \(ns.localizedDescription) \(ns.userInfo)")
      }
    }
    #endif
    throw OnDeviceLlmError.unavailable("requiresIOS26")
  }
}
