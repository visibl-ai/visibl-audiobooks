import {onRequest} from "firebase-functions/v2/https";
import {processModalCallback, handleModalCallback} from "../modal/callback.js";
import {mediumDispatchInstance} from "../util/dispatch.js";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {firebaseHttpFnConfig} from "../config/config.js";
export const v1ModalCallback = onRequest(firebaseHttpFnConfig, handleModalCallback);

export const v1ProcessModalCallback = onTaskDispatched(
    mediumDispatchInstance(),
    async (req) => {
      return await processModalCallback(req.data);
    },
);
