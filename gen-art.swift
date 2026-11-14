// SATI — gera arte da loja (ícones PWA + og-image) sem dependências.
import Cocoa

let dir = "/Users/matheuscarvalho/apps/sati-store/assets"
let obsidian = NSColor(calibratedRed: 0x0A/255.0, green: 0x0A/255.0, blue: 0x0E/255.0, alpha: 1)
let gold     = NSColor(calibratedRed: 0xC6/255.0, green: 0xA1/255.0, blue: 0x5B/255.0, alpha: 1)
let goldDim  = NSColor(calibratedRed: 0xC6/255.0, green: 0xA1/255.0, blue: 0x5B/255.0, alpha: 0.35)
let ivory    = NSColor(calibratedWhite: 0.88, alpha: 1)
let ivoryDim = NSColor(calibratedWhite: 0.62, alpha: 1)

struct Ctx { let rep: NSBitmapImageRep; let cg: CGContext }

func canvas(_ w: Int, _ h: Int) -> Ctx {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let cg = NSGraphicsContext.current!.cgContext
    cg.setAllowsAntialiasing(true)
    cg.setShouldAntialias(true)
    return Ctx(rep: rep, cg: cg)
}

func finish(_ c: Ctx, _ path: String) {
    NSGraphicsContext.restoreGraphicsState()
    guard let data = c.rep.representation(using: .png, properties: [:]) else { fatalError("png fail") }
    try! data.write(to: URL(fileURLWithPath: path))
    print(path, data.count, "bytes")
}

func frame(_ ctx: CGContext, _ S: CGFloat, inset: CGFloat, lw: CGFloat, color: NSColor) {
    color.setStroke(); ctx.setLineWidth(lw)
    ctx.stroke(CGRect(x: inset, y: inset, width: S - 2*inset, height: S - 2*inset))
}

func didot(_ size: CGFloat) -> NSFont { NSFont(name: "Didot", size: size) ?? NSFont(name: "Times New Roman", size: size)! }

func drawText(_ s: String, _ ctx: CGContext, at center: CGPoint, font: NSFont, color: NSColor, kern: CGFloat) {
    ctx.saveGState()
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color, .kern: kern
    ]
    let a = NSAttributedString(string: s, attributes: attrs)
    let b = a.size()
    a.draw(at: CGPoint(x: center.x - b.width/2 - kern/2, y: center.y - b.height/2))
    ctx.restoreGState()
}

func icon(_ S: Int) {
    let c = canvas(S, S)
    obsidian.setFill(); c.cg.fill(CGRect(x: 0, y: 0, width: S, height: S))
    frame(c.cg, CGFloat(S), inset: CGFloat(S)*0.10,  lw: max(1.5, CGFloat(S)*0.008), color: gold)
    frame(c.cg, CGFloat(S), inset: CGFloat(S)*0.135, lw: max(0.75, CGFloat(S)*0.004), color: goldDim)
    drawText("S", c.cg, at: CGPoint(x: CGFloat(S)/2, y: CGFloat(S)/2 - CGFloat(S)*0.01), font: didot(CGFloat(S)*0.52), color: gold, kern: 0)
    finish(c, "\(dir)/icon-\(S).png")
}

func appleTouch() {
    let S = 180
    let c = canvas(S, S)
    obsidian.setFill(); c.cg.fill(CGRect(x: 0, y: 0, width: S, height: S))
    frame(c.cg, CGFloat(S), inset: CGFloat(S)*0.10, lw: 1.5, color: gold)
    drawText("S", c.cg, at: CGPoint(x: CGFloat(S)/2, y: CGFloat(S)/2 - 2), font: didot(CGFloat(S)*0.52), color: gold, kern: 0)
    finish(c, "\(dir)/apple-touch-icon.png")
}

func ogImage() {
    let W = 1200, H = 630
    let c = canvas(W, H)
    obsidian.setFill(); c.cg.fill(CGRect(x: 0, y: 0, width: W, height: H))
    if let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                             colors: [NSColor(calibratedWhite: 1, alpha: 0.06).cgColor, NSColor.clear.cgColor] as CFArray,
                             locations: [0, 1]) {
        c.cg.drawRadialGradient(grad, startCenter: CGPoint(x: 600, y: H - 300), startRadius: 0,
                                endCenter: CGPoint(x: 600, y: H - 300), endRadius: 540, options: [])
    }
    frame(c.cg, CGFloat(W), inset: 36, lw: 1.5, color: gold)
    drawText("S A T I", c.cg, at: CGPoint(x: 600, y: H - 250), font: didot(185), color: gold, kern: 24)
    drawText("T H E   G R O W T H   A T E L I E R", c.cg, at: CGPoint(x: 600, y: H - 372),
             font: NSFont(name: "Helvetica Neue", size: 22)!, color: ivoryDim, kern: 10)
    // filete central
    gold.setStroke(); c.cg.setLineWidth(1)
    c.cg.move(to: CGPoint(x: 460, y: H - 430)); c.cg.addLine(to: CGPoint(x: 740, y: H - 430)); c.cg.strokePath()
    drawText("Followers · Likes · Views — delivered quietly.", c.cg, at: CGPoint(x: 600, y: H - 486),
             font: NSFont(name: "Georgia", size: 27)!, color: ivory, kern: 0.5)
    finish(c, "\(dir)/og.png")
}

for s in [192, 512] { icon(s) }
appleTouch()
ogImage()
print("arte pronta")
