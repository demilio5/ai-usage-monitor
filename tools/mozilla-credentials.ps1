# Read the existing generic credential in memory. Never emit credential values.
function Invoke-WithMozillaCredential {
  param([string]$Target, [scriptblock]$Action)
  if (-not ('AiUsageReleaseCredential' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AiUsageReleaseCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount;
    public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
  public static string[] Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      var value = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      return new[] { value.UserName, Marshal.PtrToStringUni(value.CredentialBlob, value.CredentialBlobSize / 2) };
    } finally { CredFree(ptr); }
  }
}
'@
  }
  $credential = [AiUsageReleaseCredential]::Read($Target)
  try {
    if (-not $credential -or -not $credential[0] -or -not $credential[1]) {
      throw 'The configured Mozilla generic credential was not found or is incomplete.'
    }
    $env:WEB_EXT_API_KEY = $credential[0].Trim()
    $env:WEB_EXT_API_SECRET = $credential[1].Trim()
    & $Action
  } finally {
    Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
    if ($credential) { [Array]::Clear($credential, 0, $credential.Length) }
  }
}
