Pod::Spec.new do |s|
  s.name           = 'KarakiCalls'
  s.version        = '1.0.0'
  s.summary        = 'CallKit and PushKit for Karaki: ringing like a phone call'
  s.description    = 'Reports VoIP pushes to CallKit at once (even when the app was closed), and hands answer, end, mute and audio events to JavaScript.'
  s.author         = 'BeSmart'
  s.homepage       = 'https://besmart-me.com'
  s.license        = { :type => 'Proprietary', :text => 'Karaki, BeSmart. All rights reserved.' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # the WebRTC build react-native-webrtc uses; needed to hand CallKit's audio session to WebRTC
  s.dependency 'JitsiWebRTC'
  s.frameworks = 'CallKit', 'PushKit', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.{h,m,swift}'
end
