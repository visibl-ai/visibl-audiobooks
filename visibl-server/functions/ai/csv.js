import {Parser} from "@json2csv/plainjs";

const jsonToCsv = (jsonArray, start = 0, end = jsonArray.length) => {
  // Handle empty arrays or invalid input
  if (!jsonArray || jsonArray.length === 0 || start >= jsonArray.length) {
    return "";
  }
  const opts = {fields: Object.keys(jsonArray[0])};
  const parser = new Parser(opts);
  const csv = parser.parse(jsonArray.slice(start, end));
  return csv;
};

export default jsonToCsv;

