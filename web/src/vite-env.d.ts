/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UVF_MAX_BUFFER_BYTES?: string
  readonly VITE_UVF_MAX_TOTAL_BUFFER_BYTES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
