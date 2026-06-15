declare module 'kuroshiro' {
  export default class Kuroshiro {
    init(analyzer: any): Promise<void>
    convert(text: string, options: any): Promise<string>
  }
}
declare module 'kuroshiro-analyzer-kuromoji' {
  export default class KuromojiAnalyzer {
    constructor(options: { dictPath: string })
  }
}
