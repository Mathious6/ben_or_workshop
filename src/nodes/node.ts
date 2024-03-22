import express from "express";
import {BASE_NODE_PORT} from "../config";
import {NodeState, Value} from "../types";
import * as console from "console";

const ROUND_R = "R";
const ROUND_P = "P";

interface ValueCounts {
    countValues0: number;
    countValues1: number;
}


export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
    const node = express();
    node.use(express.json());

    let nodeState: NodeState = {
        killed: false,
        x: initialValue as Value,
        decided: false,
        k: 1
    };

    let roundRMessages: Map<number, Value[]> = new Map();
    let roundPMessages: Map<number, Value[]> = new Map();

    function setNodeState(x: number, decided: boolean) {
        nodeState.x = x as Value;
        nodeState.decided = decided;
    }

    node.post("/message", async (req, res) => {
        let {R, k, x} = req.body;
        if (!isFaulty && !nodeState.killed) {
            if (R == ROUND_R) {
                let roundRProcessedMessages = processMessage(roundRMessages, k, x);
                if (roundRProcessedMessages.length >= (N - F)) {
                    const {countValues0, countValues1} = countValues(roundRProcessedMessages);
                    let v = "?" as Value;
                    if (countValues0 > (N / 2)) {
                        v = 0;
                    } else if (countValues1 > (N / 2)) {
                        v = 1;
                    }
                    await sendAllMessage(ROUND_P, k, v, N);
                }
            } else if (R == ROUND_P) {
                let roundPProcessedMessages = processMessage(roundPMessages, k, x);
                if (roundPProcessedMessages.length >= N - F) {
                    const {countValues0, countValues1} = countValues(roundPProcessedMessages);
                    if (countValues0 >= F + 1) {
                        setNodeState(0, true);
                    } else if (countValues1 >= F + 1) {
                        setNodeState(1, true);
                    } else {
                        const totalValues = countValues0 + countValues1;
                        nodeState.x = totalValues > 0 ? (countValues0 > countValues1 ? 0 : 1) : Math.random() > 0.5 ? 0 : 1;
                        nodeState.k = k + 1;
                        sendAllMessage(ROUND_R, k + 1, nodeState.x, N);
                    }
                }
            }
            res.status(200).send("message");
        } else {
            res.status(500).send("faulty");
        }
    });

    node.get("/status", (_, res) => {
        if (isFaulty) {
            res.status(500).send("faulty");
        } else {
            res.status(200).send("live");
        }
    });

    node.get("/start", async (_, res) => {
        if (!isFaulty) {
            nodeState.decided = false;
            nodeState.x = initialValue;
            nodeState.k = 1;
            await sendAllMessage(ROUND_R, nodeState.k, nodeState.x, N);
        }
        res.status(200).send("started");
    });

    node.get("/stop", (_, res) => {
        nodeState.killed = true;
        res.status(200).send("stopped");
    });

    node.get("/getState", (_, res) => {
        if (isFaulty) {
            nodeState.x = null;
            nodeState.k = null;
            nodeState.decided = null;
        }

        res.status(200).send({x: nodeState.x, k: nodeState.k, killed: nodeState.killed, decided: nodeState.decided});
    });


    return node.listen(BASE_NODE_PORT + nodeId, async () => {
        console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
        setNodeIsReady(nodeId);
    });
}

async function sendAllMessage(R: string, k: number, x: Value, N: number) {
    const promises = Array.from({length: N}, (_, i) =>
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({"R": R, "k": k, "x": x})
        })
    );
    await Promise.all(promises);
}

function processMessage(messages: Map<number, Value[]>, k: number, x: Value): Value[] {
    const messageArray = messages.get(k) ?? [];
    messageArray.push(x);
    messages.set(k, messageArray);
    return messageArray;
}

function countValues(array: Value[]): ValueCounts {
    let countValues0 = 0;
    let countValues1 = 0;

    for (const value of array) {
        if (value === 0) {
            countValues0 += 1;
        } else if (value === 1) {
            countValues1 += 1;
        }
    }

    return {countValues0, countValues1};
}