// Copyright (c) Alex Ellis 2021. All rights reserved.
// Copyright (c) OpenFaaS Author(s) 2021. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

"use strict"

const express = require('express');
const morgan = require('morgan');
const app = express();

const manifestHandler = require('./index.js');
const defaultMaxSize = '100kb'; // body-parser default

const rawLimit = process.env.MAX_RAW_SIZE || defaultMaxSize;
const jsonLimit = process.env.MAX_JSON_SIZE || defaultMaxSize;

let listenerHandlers = null;
let widgetHandlers = null;
let manifest = null;

const RESOURCE_TYPE = "resource";
const LISTENER_TYPE = "listener";
const WIDGET_TYPE = "widget";
const MANIFEST_TYPE = "manifest";

app.disable('x-powered-by');

app.use(morgan(function (tokens, req, res) {
    return [
        tokens.method(req, res),
        tokens.url(req, res),
        'type:', get_req_type(req),
        tokens.status(req, res),
        tokens['response-time'](req, res), 'ms'
    ].join(' ')
}))
app.use(function addDefaultContentType(req, res, next) {
    // When no content-type is given, the body element is set to
    // nil, and has been a source of contention for new users.

    if (!req.headers['content-type']) {
        req.headers['content-type'] = "text/plain"
    }
    next()
})

if (process.env.RAW_BODY === 'true') {
    app.use(express.raw({ type: '*/*', limit: rawLimit }))
} else {
    app.use(express.text({ type: "text/*" }));
    app.use(express.json({ limit: jsonLimit }));
    app.use(express.urlencoded({ extended: true }));
}

const get_req_type = (req) => {
    if (req.method !== "POST") return "none";
    if (req.body.resource) {
        return RESOURCE_TYPE;
    } else if (req.body.action) {
        return LISTENER_TYPE;
    } else if (req.body.widget) {
        return WIDGET_TYPE;
    } else {
        return MANIFEST_TYPE;
    }
}

const middleware = async (req, res) => {
    switch (get_req_type(req)) {
        case RESOURCE_TYPE:
            handleAppResource(req, res);
            break;

        case LISTENER_TYPE:
            handleAppListener(req, res);
            break;

        case WIDGET_TYPE:
            handleAppWidget(req, res);
            break;

        case MANIFEST_TYPE:
            handleAppManifest(req, res);
            break;

        default:
            throw "Middleware type unknown.";

    }
};

function handleAppResource(req, res) {
    const resources_path = "./resources/";

    // Checking file extensions according to which ones Flutter can handle
    if (req.body.resource.match(/.*(\.jpeg|\.jpg|\.png|\.gif|\.webp|\.bmp|\.wbmp)$/)) {
        res.sendFile(req.body.resource, { root: resources_path });
    } else {
        res.sendStatus(404);
    }
}

async function initManifest() {
    if (manifest == null) {
        let tempManifest = await manifestHandler();
        widgetHandlers = tempManifest.widgets;
        listenerHandlers = tempManifest.listeners || {};
        widgetHandlers = tempManifest.widgets;
        listenerHandlers = tempManifest.listeners || {};
        manifest = {
            widgets: Object.keys(widgetHandlers),
            listeners: Object.keys(listenerHandlers),
            rootWidget: tempManifest.rootWidget
        };
    }
    return Promise.resolve(manifest);
}

async function handleAppManifest(req, res) {


    return initManifest().then(manifest => {

        res.status(200).json({ manifest: manifest });
    })
        .catch(err => {
            const err_string = err.toString ? err.toString() : err;
            console.error("handleAppManifest:", err_string);
            res.status(500).send(err_string);
        });
}

async function handleAppWidget(req, res) {
    let { widget, data, props } = req.body;

    if (Object.keys(widgetHandlers).includes(widget)) {
        let possibleFutureRes = widgetHandlers[widget](data, props)

        return Promise.resolve(possibleFutureRes)
            .then(widget => {

                res.status(200).json({ widget: widget });
            })
            .catch(err => {
                const err_string = err.toString ? err.toString() : err;
                console.error('handleAppWidget:', err_string);
                res.status(500).send(err_string);
            });
    } else {
        let msg = `No widget found for name ${widget} in app manifest.`;
        console.error(msg);
        res.status(404).send(msg);
    }

}

/**
 * This is the main entry point for the OpenFaaS function.
 *
 * This function will call the index.js file of the application
 * when the page change.
 * If an event is triggered, the matched event function provided by the app is triggered.
 * The event can be a listener or a widget update.
 */
async function handleAppListener(req, res) {
    let { action, props, event, api } = req.body;
    /*
        listeners file need to exactly math with action name
    */
    if (Object.keys(listenerHandlers).includes(action)) {
        let possibleFutureRes = listenerHandlers[action](props, event, api);

        return Promise.resolve(possibleFutureRes)
            .then(() => {
                res.status(200).send();
            })
            .catch(err => {
                const err_string = err.toString ? err.toString() : err;
                console.error('handleAppAction:', err_string);
                res.status(500).send(err_string);
            });
    } else {
        console.error(`No listener found for action ${action} in app manifest.`);
        res.status(404).send(`No listener found for action ${action} in app manifest.`);
    }
}

//middleware to catch ressource
app.post('/*', middleware);

const port = process.env.http_port || 3000;

initManifest().then(() => {
    app.listen(port, () => {
        console.log(`node12 listening on port: ${port}`)
    });
}).catch(err => {
    console.error(err);
});
