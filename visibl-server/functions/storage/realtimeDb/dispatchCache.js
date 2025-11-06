/* eslint-disable require-jsdoc */
import {storeData, getData} from "./database.js";

function dispatchFunctionToRef({functionName}) {
  return `dispatch/${functionName}`;
}

async function storeDispatchFunction({functionName, uri}) {
  const dbRef = dispatchFunctionToRef({functionName});
  await storeData({ref: dbRef, data: {uri}});
}

async function getDispatchFunction({functionName}) {
  const dbRef = dispatchFunctionToRef({functionName});
  const data = await getData({ref: dbRef});
  if (!data) {
    return null;
  }
  return data.uri;
}

export {
  storeDispatchFunction,
  getDispatchFunction,
};
