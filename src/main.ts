import koa = require('koa');
import fs = require('fs');
import * as Static from 'koa-static';
import * as send from 'koa-send';

import { adminapi } from './adminapi';
import { settings } from './settings';
import { addDefinitions, addTypes } from './r3';
import { userapi } from './userapi';
import { User, Board } from './database/schema';

import { MongoClient, Db, Collection } from 'mongodb';

const url = `mongodb://${settings.db.host}:${settings.db.port || 27017}`;
export let p8chandb: Db;

export let Boards: Collection<Board>;
export let Admins: Collection<User>;
//export let Posters: Collection<Poster>;


export type QueryOperation<T> =
    { [op in '$and' | '$add' | '$divide']: Array<AggregationQuery<T>> } | {};
type QueryValue = string | number | RegExp;
type AggregationQuery<T> = QueryFieldOf<T> | QueryOperation<T> | QueryValue;
type QueryFieldOf<T> = { [key in keyof T]?: QueryValue };

export type AggregationPipelineStage<T> =
    { $match: AggregationQuery<QueryFieldOf<T>> } |
    { $addFields: { [k: string]: QueryOperation<T> } } |
    { $sort: { [key in keyof T]?: -1 | 1 } } |
    undefined;


let inited = false;
export let init = async () => {
    let connection = await MongoClient.connect(url, {
        useUnifiedTopology: true,
        useNewUrlParser: true
    });
    p8chandb = connection.db(settings.db.database);
    Boards = p8chandb.collection('Boards');
    Admins = p8chandb.collection('Administration');
    // Posters = p8chandb.collection('Posters');
}

let fsp = fs.promises;

(async () => {
    try {
        //addTypes(["@koa/multer"])
        addDefinitions('./apiv1.js');

        await init();
        //p8chandb.on("trace", (str) => console.log(str));
        //getBoardSettings('g');
        let root = new koa();
        root.proxy = true; // placé derrière un nginx
        root
            .use(adminapi.routes())
            .use(adminapi.allowedMethods())
            .use(userapi.routes())
            .use(userapi.allowedMethods())
            .use(Static(settings.frontend, {
                index: 'index.html',
                root: settings.frontend
            })).use((c) => {
                return send(c, 'index.html', { root: settings.frontend })
            }
            );
        //    root.use(boardapi);
        root.listen({ port: settings.port, host: '127.0.0.1' }, () => {
        })
    } catch (e) {
        console.error(e);
    }
})();
