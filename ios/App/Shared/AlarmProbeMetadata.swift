#if canImport(AlarmKit)
import AlarmKit

// Compiled into both the phone and widget extension; no task or private data.
@available(iOS 26.1, *)
struct AlarmProbeMetadata: AlarmMetadata {
    var title: String? = nil
    var detail: String? = nil
}
#endif
