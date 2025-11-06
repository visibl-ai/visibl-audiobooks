import {getEncoding} from "js-tiktoken";
const DEFAULT_TOKENIZER = "cl100k_base";
const enc = getEncoding(DEFAULT_TOKENIZER);

const tokenHelper = {
  countTokens: (text) => {
    return enc.encode(text).length;
  },
};

export default tokenHelper;
