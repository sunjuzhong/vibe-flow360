export type LocalePack<Code extends string = string> = {
  code: Code
  nativeName: string
  displayName: string
  systemPrefixes: readonly string[]
  documentTitle: string
  documentDescription: string
  translate: (value: string) => string
}
