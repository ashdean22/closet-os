import Vision
import AppKit

// Prints one line per recognised string: text<TAB>centre_x<TAB>centre_y in
// pixels of the source image. Used to find UI labels the colour probes cannot
// tell apart ("Show me the next look" vs "Style something new").
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERR: cannot read \(path)")
    exit(1)
}
let w = CGFloat(cg.width), h = CGFloat(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([req])
for obs in (req.results ?? []) {
    guard let top = obs.topCandidates(1).first else { continue }
    let bb = obs.boundingBox                    // normalised, origin bottom-left
    let cx = (bb.origin.x + bb.width / 2) * w
    let cy = (1 - (bb.origin.y + bb.height / 2)) * h
    print("\(top.string)\t\(Int(cx))\t\(Int(cy))")
}
