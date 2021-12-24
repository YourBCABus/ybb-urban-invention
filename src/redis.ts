import { createClient } from "redis";

import crypto from "crypto";
import ChangeQueue, { BoardingAreaChangeMessage } from "./changeQueue.js";
import { RedisClientType } from "@node-redis/client/dist/lib/client";

const id = process.env.YBB_CLIENT_ID ?? "000000000000000000000000";
const redisHostName = process.env.REDIS_HOST ?? "localhost";
const redisPort = parseInt(process.env.REDIS_PORT ?? "6379");
const redisDb = parseInt(process.env.REDIS_DB ?? "0");

let called = false;

export default function initRedis(changeQueue: ChangeQueue): Promise<void> {
    if (!called) {
        called = true;
        return _initRedis(changeQueue);
    } else return Promise.reject(new Error("initRedis was already called!"));
}

type PubSubCallback = (eventData: string) => void;

type PubSubCreator = (callback: PubSubCallback) => Promise<void>;

type SubscriptionPromises = {
    boardingAreaChange: PubSubCreator,
    // TODO: Implement subscription to other channels.
};

function newSubCreator(channel: string, client: RedisClientType<any>) {
    return (callback: PubSubCallback) => client.subscribe(channel, callback);
}

function getSubscriptions(): SubscriptionPromises {
    const redisPubSubClient = createClient();
    
    const subscriptionCreators: SubscriptionPromises = {
        boardingAreaChange: newSubCreator("BUS_BOARDING_AREA_CHANGE", redisPubSubClient),
    };


    return subscriptionCreators;
}

async function _initRedis(changeQueue: ChangeQueue) {
    const { boardingAreaChange } = getSubscriptions();

    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(id, "ascii"));
    const hashDigest = hash.digest("base64");

    await Promise.all([
        boardingAreaChange((message) => {
            console.log(message);
            const messageObj: BoardingAreaChangeMessage = JSON.parse(message);
            if (hashDigest === messageObj.clientHash) return;

            changeQueue.queueBoardingAreaChange(messageObj);
        }),
    ]);
}
