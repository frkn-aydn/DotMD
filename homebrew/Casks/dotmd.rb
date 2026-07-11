cask "dotmd" do
  version "1.2.0"

  on_arm do
    sha256 "f7926c7bc67059fc070e79aa59f8ed7f32d7986abbe0e902394e4a0428ae06ab"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}-arm64.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
  end
  on_intel do
    sha256 "30417e7654c5a48388c43e33066d5048ad78cafb63485941f70cf5942a81e35e"
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
