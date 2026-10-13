package expo.modules.ondevicellm

import androidx.annotation.RequiresApi
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

// Gemini Nano via ML Kit GenAI Prompt API (AICore). Free and on-device, but only
// on supported phones (e.g. Pixel 9+, recent Galaxy S). No guided generation, so
// the model is asked for JSON and the JS side validates it.
@RequiresApi(26)
internal class GeminiNanoEngine {
  private val model: GenerativeModel by lazy { Generation.getClient() }

  @Volatile
  private var downloadJob: Job? = null

  /** { status: available | downloadable | downloading | unavailable, reason } */
  suspend fun status(): Map<String, String> =
    try {
      when (model.checkStatus()) {
        FeatureStatus.AVAILABLE -> result("available")
        FeatureStatus.DOWNLOADABLE -> result("downloadable")
        FeatureStatus.DOWNLOADING -> result("downloading")
        else -> result("unavailable", "deviceNotSupported")
      }
    } catch (e: GenAiException) {
      result("unavailable", "genAiError${e.errorCode}")
    } catch (e: Exception) {
      result("unavailable", e.javaClass.simpleName)
    }

  suspend fun prepare(scope: CoroutineScope): Map<String, String> {
    val current = status()
    when (current["status"]) {
      "downloadable" -> {
        if (downloadJob?.isActive != true) {
          downloadJob = scope.launch {
            try {
              model.download().collect { }
            } catch (_: Exception) {
              // Status stays "downloadable"; the next prepare() retries.
            }
          }
        }
        return result("downloading")
      }
      "available" -> {
        try {
          model.warmup()
        } catch (_: Exception) {
          // Warmup is an optimisation only.
        }
      }
    }
    return current
  }

  suspend fun generate(instructions: String, prompt: String): String {
    val request = generateContentRequest(TextPart("$instructions\n\n$prompt\n\nRespond with the JSON object only.")) {
      temperature = 0.1f
      topK = 1
      maxOutputTokens = MAX_OUTPUT_TOKENS
    }
    val response = withTimeout(GENERATION_TIMEOUT_MS) { model.generateContent(request) }
    val text = response.candidates.firstOrNull()?.text
    if (text.isNullOrBlank()) throw IllegalStateException("empty response")
    return stripCodeFences(text)
  }

  fun close() {
    downloadJob?.cancel()
    model.close()
  }

  private fun result(status: String, reason: String = "") = mapOf("status" to status, "reason" to reason)

  private companion object {
    const val MAX_OUTPUT_TOKENS = 400
    const val GENERATION_TIMEOUT_MS = 20_000L
  }
}

/** Gemini Nano tends to wrap JSON in ```json fences; keep only the object. */
internal fun stripCodeFences(text: String): String {
  val trimmed = text.trim()
  val start = trimmed.indexOf('{')
  val end = trimmed.lastIndexOf('}')
  return if (start >= 0 && end > start) trimmed.substring(start, end + 1) else trimmed
}
