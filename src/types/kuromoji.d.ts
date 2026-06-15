declare module 'kuromoji' {
  export interface Token {
    surface_form: string
    reading?: string
    pos?: string
    pos_detail_1?: string
    basic_form?: string
  }

  export interface Tokenizer {
    tokenize(text: string): Token[]
  }

  export interface Builder {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void
  }

  export function builder(options: { dicPath: string }): Builder
}
