// Windows UI typeface matching the installer's display language. A typeface for
// another script would draw shared Han characters with that region's glyph shapes.
static const WCHAR* InstallerFontFaceFor(int language) {
    switch (PRIMARYLANGID(language)) {
    case LANG_CHINESE: return L"Microsoft YaHei UI";
    case LANG_JAPANESE: return L"Yu Gothic UI";
    default: return L"Segoe UI";
    }
}

// The NSIS pages create their GDI fonts from the same face the native pages draw with.
extern "C" __declspec(dllexport) const WCHAR* __cdecl InstallerFontFace(int language) {
    return InstallerFontFaceFor(language);
}
