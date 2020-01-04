import { Boards } from "../main";

import Application = require("koa");
import fileType = require('file-type');
import path = require('path');
import sharp = require("sharp");
import tripcode = require("tripcode");

import * as api from '../apiv1';
import * as schema from './schema';
import { Binary } from "mongodb";
import { getJWTPayload } from "../utils";

declare function emit(k: any, v: any): any;

let filterpost = (data: schema.Post[]): api.Post[] => {
    return data.map(d => {
        let p: api.Post = {
            comment: d.comment,
            date: d.date,
            id: d.id,
            email: d.email,
            subject: d.subject,
        };
        if (d.file)
            [p.fw, p.fh, p.fs, p.fn] =
                [d.file.width, d.file.height, d.file.size, d.file.name];

        if (d.name) {
            let spl = d.name.split('#')
            if (spl.length == 1)
                p.name = spl[0];
            if (spl.length == 2) {
                p.name = spl[0];
                p.trip = tripcode(spl[1]);
            }
        }
        return p;
    })
};

type File = Application.DefaultContext['file'];

let sanitizeFile = async (file: Readonly<File>) => {
    let realtype = fileType(file.buffer);
    if (!realtype || !['png', 'jpg', 'gif', 'jpeg', 'webp'].includes(realtype.ext))
        throw { status: 400, message: "Unsupported file type" };
    let bn = path.basename(file.originalname, path.extname(file.originalname));
    let filename = `${bn}.${realtype.ext}`;
    let meta = await sharp(file.buffer).metadata();
    return { ...file, ...{ meta }, ...{ filename } };
}

let assertChallenge = async (board: string, ip: string, challenge: api.JWT<{ for: string, exp: number }>) => {
    let now = +new Date();
    let pl = getJWTPayload(challenge);
    if (now > pl.exp)
        throw "Authorization expired."
    if (pl.for != ip)
        throw "This authorization wasn't issued to you";
    let poster = await Boards.aggregate<{ date: number }>([
        {
            '$match': {
                'name': board
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$project': {
                'replies': '$threads.replies'
            }
        }, {
            '$unwind': {
                'path': '$replies'
            }
        }, {
            '$project': {
                'ip': '$replies.ip',
                'date': {
                    '$max': '$replies.date'
                }
            }
        }, {
            '$match': {
                'ip': ip
            }
        }, {
            '$group': {
                '_id': null,
                'date': {
                    '$max': '$date'
                }
            }
        }
    ]).toArray();
    if (poster.length == 0)
        return;
    if (now < (poster[0].date + 60 * 1000))
        throw "You're posting too fast.";
}

let tuple = <T extends string, U extends [T, ...T[]]>(...args: U): U => args;

let sanitizePostUpload = (post: api.PostUpload) => {
    post.comment = post.comment?.substr(0, 2000).replace(/[\r\n]{2,}/g, "\n");
    const smallfields = tuple('email', 'subject', 'name');
    let k: typeof smallfields[number];
    for (k of smallfields)
        post[k] = post[k]?.substr(0, 20);
}

export let replyToThread = async (board: string, thread: number, reply: api.PostUploadWithoutFile, file: File | undefined, ip: string) => {
    let b = await Boards.findOne({ name: board });
    if (!b)
        throw "Unknown board";
    sanitizePostUpload(reply);
    await assertChallenge(board, ip, reply.challenge);
    delete reply.challenge; // challenge validé, on le vire pour pas le garder en BDD

    let t = await getOp(board, thread);
    if (!t)
        throw "Unknown thread";

    type UnboxPromise<T extends Promise<unknown>> = T extends Promise<infer U> ? U : never;
    let saneFile: UnboxPromise<ReturnType<typeof sanitizeFile>>;
    let thumbnail: Buffer;
    if (file) {
        if (file.size > b.filesize_limit)
            throw "Maximum file size exceeded";
        saneFile = await sanitizeFile(file);
        thumbnail = await sharp(saneFile.buffer)
            .flatten({ background: '#eeaa88' })
            .resize({
                width: 125,
                height: 125,
                fit: 'inside'
            })
            .toFormat('jpeg', { force: true })
            .toBuffer();
    }
    let nnum = await getBoardLastNum(board);
    ++nnum;
    let ctime = +new Date();
    Boards.updateOne({
        name: board
    }, {
        ... (reply.email != 'sage' ? { $set: { 'threads.$[elem].last_bump': ctime } } : {}),
        $push: {
            "threads.$[elem].replies": {
                ...reply,
                id: nnum,
                date: ctime,
                ... (file ? {
                    file: {
                        width: saneFile!.meta.width,
                        height: saneFile!.meta.height,
                        size: saneFile!.size,
                        image: saneFile!.buffer,
                        thumbnail: thumbnail!,
                        name: saneFile!.filename
                    }
                } : {}),
                ip: ip
            }
        },
    }, {
        arrayFilters: [{
            'elem.replies.0.id': thread
        }]
    })
};

export let getThreads = async (board: string) => {
    let data = await Boards.aggregate<{ id: number } & Pick<schema.Thread, 'last_bump' | 'sticky'>>([
        {
            '$match': {
                'name': board
            }
        }, {
            '$project': {
                'threads': 1
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$project': {
                'sticky': '$threads.sticky',
                'last_bump': '$threads.last_bump',
                'op': {
                    '$arrayElemAt': [
                        '$threads.replies', 0
                    ],
                }
            }
        }, {
            '$project': {
                'sticky': 1,
                'last_bump': 1,
                '_id': 0,
                'id': '$op.id'
            }
        }
    ]).toArray();
    return data;
};

export let getThread = async (board: string, id: number) => {
    let data = await Boards.aggregate<schema.Thread>([
        {
            '$match': {
                'name': board
            }
        }, {
            '$project': {
                'threads': 1
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$match': {
                'threads.replies.0.id': id
            }
        }, {
            '$project': {
                'sticky': '$threads.sticky',
                'replies': '$threads.replies',
                'last_bump': '$threads.last_bump',
                '_id': 0
            }
        }
    ]).toArray();
    if (data.length == 0)
        throw "No such thread";
    let res = data[0];
    return filterpost(res.replies);
};

export let getOp = async (board: string, id: number) => {
    let data = await Boards.aggregate<schema.Thread>([
        {
            '$match': {
                'name': board
            }
        }, {
            '$project': {
                'threads': 1
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$project': {
                'sticky': '$threads.sticky',
                'last_bump': '$threads.last_bump',
                'op': {
                    '$arrayElemAt': [
                        '$threads.replies', 0
                    ],
                }
            }
        }, {
            '$project': {
                'sticky': 1,
                'last_bump': 1,
                '_id': 0,
                'id': '$op.id'
            }
        }, {
            '$match': { id }
        }
    ]).toArray();
    if (data.length == 0)
        throw "No such thread";
    return data[0];
};


export let createThread = async (board: string, op: api.PostUploadWithoutFile, file: File, ip: string) => {
    let b = await Boards.findOne({ name: board });
    if (!b)
        throw "Unknown board";

    let saneFile = await sanitizeFile(file);
    // ajoute un post

    let thumbnail = await sharp(saneFile.buffer)
        .flatten({ background: '#f1f3ee' })
        .resize({ width: 250, height: 250, fit: 'inside' })
        .toFormat('jpeg', { force: true })
        .toBuffer();
    let nnum = await getBoardLastNum(board);
    let now = +new Date();
    ++nnum;
    await Boards.updateOne({
        name: board
    }, {
        $push: {
            threads: {
                sticky: false,
                last_bump: now,
                replies: [{
                    ...op,
                    id: nnum,
                    date: now,
                    file: {
                        width: saneFile.meta.width,
                        height: saneFile.meta.height,
                        size: saneFile.size,
                        image: saneFile.buffer,
                        thumbnail,
                        name: saneFile.filename
                    },
                    ip
                }]
            } as any
        }
    });
    return nnum;
};

export let setBoard = async (name: string, settings: api.BoardSetting) =>
    Boards.updateOne({ name }, settings)

export let deleteBoard = async (name: string) => {
    if (!await getBoard(name))
        throw "No such board";
    return Boards.deleteOne({ name });
};

export let createBoard = async (settings: api.BoardSetting) => {
    if (await getBoard(settings.name))
        throw "This board already exists";
    let newBoard = { ...settings, threads: [] }
    return Boards.insertOne(newBoard);
};

export let getBoard = async (name: string) => {
    let boards = Boards.findOne({ name }, { projection: { replies: 0 } })
    return boards;
};

export let getBoards = () => {
    let boards = Boards.find({}, { projection: { threads: 0 } })
    return boards.toArray()
}

async function getBoardLastNum(board: string | number): Promise<number> {
    let arr = await Boards.aggregate<{ id: number }>([
        {
            '$match': {
                'name': board
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$unwind': {
                'path': '$threads.replies'
            }
        }, {
            '$count': 'id'
        }
    ]).toArray();
    return arr.length ? arr[0].id : 0;
}

// Quand on stock un Buffer avec le pilote, il restituera un Binary après une requete, 
// mais n'indique pas ce changement dans le type sous jacent
// Mongol<T> Renvoie donc un type T où tout les Buffer sont récursivement remplacés par des Binary
export type Mongol<T> = {
    // Ca ne devrait pas marcher, mais ca marche
    [k in keyof T]: T[k] extends Buffer ? Binary : Mongol<T[k]>
}

export let getFile = async (name: string, date: number) => {
    let arr = await Boards.aggregate<Mongol<schema.Post>>([
        {
            '$match': {
                name
            }
        }, {
            '$unwind': {
                'path': '$threads'
            }
        }, {
            '$unwind': {
                'path': '$threads.replies'
            }
        }, {
            '$match': {
                'threads.replies.date': date
            }
        }, {
            '$project': {
                'file': '$threads.replies.file'
            }
        }
    ]).toArray();
    if (arr.length == 0 || !arr[0].file)
        throw "No such file";
    let k = Object.assign({}, arr[0].file!, fileType(arr[0].file!.image.buffer));
    return k;
}
