cask "dotmd" do
  version "1.2.3"

  on_arm do
    sha256 "864c3bd3555b7301c1184809b04ad7325faf195eac621d38f923f1ba166797bc"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}-arm64.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
  end
  on_intel do
    sha256 "474cdbe7c275e66eac63eff7a55af672848dba9082d56d4cc408daa9ee449912"
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
