/* eslint-disable require-jsdoc */
import {storeData, getData} from "./database.js";
import {aaxGetItemsFirestore} from "../firestore/aax.js";
import {BOOK_RUNTIME_MIN} from "../../config/config.js";
function userToDbRef({uid}) {
  return `users/${uid}`;
}

async function usersRegisterToken({uid, data}) {
  if (!data.fcmToken) {
    throw new Error("fcmToken is required");
  }
  await storeData({ref: userToDbRef({uid}), data: {fcmToken: data.fcmToken}});
  return {fcmToken: data.fcmToken, registered: true, uid};
}

async function usersGetFcmToken({uid}) {
  return await getData({ref: `${userToDbRef({uid})}/fcmToken`});
}

async function usersGet({uids}) {
  const promises = uids.map(async (uid) => {
    const fcmToken = await getData({ref: `${userToDbRef({uid})}/fcmToken`});
    return fcmToken ? {uid, fcmToken} : null;
  });

  // Filter out null values (non-existent users)
  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

async function saveUser({uid, user}) {
  await storeData({ref: userToDbRef({uid}), data: user});
}

async function getUser({uid}) {
  return await getData({ref: userToDbRef({uid})});
}

async function usersUpdateImportedList({uid}) {
  const items = await aaxGetItemsFirestore({uid});
  // Filter for fiction items and is_listenable and isConsumableOffline and runtimeLengthMinutes >= 30
  const downloadableItems = items.filter((item) =>
    item.fiction &&
    item.isListenable &&
    item.isConsumableOffline &&
    item.runtimeLengthMinutes >= parseInt(BOOK_RUNTIME_MIN.value(), 10),
  );
  const skuArray = downloadableItems.map((item) => item.sku);
  // First get the existing list.
  const existingList = await getData({ref: `${userToDbRef({uid})}/importedSkus`});
  // Then merge the new list with the existing list, handling null case
  const mergedList = existingList ? [...existingList, ...skuArray] : skuArray;
  // Remove duplicates from the merged list using Set
  const uniqueList = [...new Set(mergedList)];
  await storeData({ref: `${userToDbRef({uid})}/importedSkus`, data: uniqueList});
}

async function deleteImportedList({uid}) {
  await storeData({ref: `${userToDbRef({uid})}/importedSkus`, data: []});
}

export {
  saveUser,
  getUser,
  usersRegisterToken,
  usersGetFcmToken,
  usersGet,
  usersUpdateImportedList,
  deleteImportedList,
};
