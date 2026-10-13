Pod::Spec.new do |s|
  s.name           = 'OnDeviceLlm'
  s.version        = '0.1.0'
  s.summary        = 'On-device LLM edit planner (Apple Foundation Models)'
  s.description    = 'Turns a photo-editing request into an edit plan with the on-device Apple Foundation Models (iOS 26+).'
  s.author         = ''
  s.homepage       = 'https://kuindzhi.app'
  s.license        = 'MIT'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # FoundationModels is imported behind `#if canImport` + `#available(iOS 26.0, *)`;
  # the linker weak-links it automatically, so older iOS versions still launch.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
