/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WHITEBOX_LOGO_URL?: string;
  readonly VITE_WHITEBOX_LINK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
