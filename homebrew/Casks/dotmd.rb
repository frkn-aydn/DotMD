cask "dotmd" do
  version "1.2.2"

  on_arm do
    sha256 "7050a40dd7025dd54ec1006e619a36a1fa6db7e618c3e1605d1489481db170cb"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}-arm64.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
  end
  on_intel do
    sha256 "5a8175984d52ecb9ec36cc0cba3196646961bbac9883e4137c87690a811dd678"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
  end

  name "DotMD"
  desc "Minimal Markdown viewer and editor with View, Edit, and Split modes"
  homepage "https://github.com/frkn-aydn/DotMD"

  app "DotMD.app"

  zap trash: [
    "~/Library/Application Support/DotMD",
    "~/Library/Preferences/com.furkanaydin.dotmd.plist",
    "~/Library/Saved Application State/com.furkanaydin.dotmd.savedState",
  ]
end
