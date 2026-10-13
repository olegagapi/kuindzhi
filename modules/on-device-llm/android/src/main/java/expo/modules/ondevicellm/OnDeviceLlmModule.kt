package expo.modules.ondevicellm

import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Thin Expo bridge; the model logic lives in GeminiNanoEngine.kt.
class OnDeviceLlmModule : Module() {
  private var engine: GeminiNanoEngine? = null

  private fun engine(): GeminiNanoEngine? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return engine ?: GeminiNanoEngine().also { engine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("OnDeviceLlm")

    AsyncFunction("getStatus") Coroutine { ->
      engine()?.status() ?: UNSUPPORTED
    }

    // Starts the Gemini Nano download when the device supports it but hasn't fetched it yet.
    AsyncFunction("prepare") Coroutine { ->
      engine()?.prepare(appContext.backgroundCoroutineScope) ?: UNSUPPORTED
    }

    AsyncFunction("generatePlan") Coroutine { instructions: String, prompt: String ->
      val current = engine() ?: throw OnDeviceLlmException("requiresAndroid8")
      try {
        current.generate(instructions, prompt)
      } catch (e: Exception) {
        throw OnDeviceLlmException(e.message ?: e.javaClass.simpleName)
      }
    }

    OnDestroy {
      engine?.close()
      engine = null
    }
  }

  companion object {
    private val UNSUPPORTED = mapOf("status" to "unavailable", "reason" to "requiresAndroid8")
  }
}

internal class OnDeviceLlmException(reason: String) :
  CodedException("ERR_ON_DEVICE_LLM", "On-device generation failed: $reason", null)
