/**
 * This module handles the data synchronization.
 * 
 * Create a publication on the backend. the publication is set to listen to data changes
 * ex:
 *  sync.publish('tasks.sync',function(tenantId,userId,params,timestamp){
 *    return taskService.fetch(params,timestamp)
 * },[TASK_DATA]);
 * }
 * 
 * subscribe to this publication on the client using the angular-sync lib.
 * 
 * When your api update, create or remove data, notify the data changes on the backend. You might provide params that must be in the subscription to react. 
 * ex:
 * function createTask(task) {
 *  ....
 *    return dataAccess.executeQuery(queryObj).then(function (r) {
        sync.notifyChanges('TASK_DATA', r);
        return r;
    });
 * }
 * 
 * all and only client subscriptions registered to the publication listening to this data change will fetch the data from the db from their last timestamp.
 * then will receive the changes (PUSH) in their cache (use getData to get instance of the cache)
 * 
 * Notes:
 * ------
 * If the client loses the connection it will re-use to the same subscription if the reconnection is fast enought. Otherwise it will re-subscribe.
 * While the client lost the connection, the subscription is caching any new notification in memory. When the client reconnects, it gets the data in the queue and acknowledge it received them.
 * If it loses the connection for a long period of time, the subcription will be destroyed...and the client will get all the data when it resubscribe.
 * 
 * IMPORTANT: The client MUST reconnect on the same node server to get what is the queue for an existing subscription...otherwise it will resubscribe on the new node server and fetch all data.
 * 
 */

var UUID = require('uuid');
var _ = require('lodash');
var initRoutes = require('./routes')
UUID.generate = UUID.v4;
const CURRENT_SYNC_VERSION = '1.2';
var activeSubscriptions = {};
var publications = {};
var debug = false;
var maxDisconnectionTimeBeforeDroppingSubscription = 20; //seconds

var sync = {
    addRoutesTo: addRoutesTo,
    publish: publish,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    notifyRemoval: notifyRemoval,
    notifyChanges: notifyChanges,
    getActiveSubscriptions: getActiveSubscriptions,
    countActiveSubscriptions: countActiveSubscriptions,
    setMaxDisconnectionTimeBeforeDroppingSubscription: setMaxDisconnectionTimeBeforeDroppingSubscription,
    getMaxDisconnectionTimeBeforeDroppingSubscription: getMaxDisconnectionTimeBeforeDroppingSubscription,
    getVersion: getVersion,
    setDebug: setDebug,
    clear: clear

};

module.exports = sync;

////////////////// PUBLIC //////////////////////

/**
 * add the routes to api
 * 
 * @param api: this is the api-router instance 
 * 
 */
function addRoutesTo(api) {
    initRoutes(api, sync);
}

/**
 * retrieve the version of the sync library
 * 
 * Note: Client library version must be same at the server's one to operate with.
 * 
 * @returns current version (string)
 */
function getVersion() {
    return CURRENT_SYNC_VERSION;
}

/**
 * subscribe to a publication.
 * If the subscription already exists on the server, reuse it.
 * 
 * @param handler: handler passed by the api router event (later on, we will decouple and only pass socket and user objects)
 * @param subscriptionId (optional): if the subscription already exists on the client, pass the id.
 * @param publicationName: the name of the publication to register to
 * @param params: the object containing the parameters to pass to the publication
 */
function subscribe(user, socket, subscriptionId, publicationName, params) {
    var subscription = activeSubscriptions[subscriptionId];
    // prevent any other users except the owner to bind to an existing subscription
    if (subscription && user.id === subscription.userId && user.tenantId === subscription.tenantId) {
        // if the client provides the subscription id...most likely it losts the network connection and is trying to subscribe to any existing one....if the reconnection is fast enough, the subscription might be still, and what is still in the queue would be sent to it.
        logSub(subscription, 'Reusing existing subscription before timeout.');
        bindSubscriptionToSocket(subscription, socket);
        subscription.emitQueue();
        return subscription;
    }

    var publication = findPublicationByName(publicationName);
    if (subscriptionId) {
        subscription = new Subscription(user, subscriptionId, publication, params);
        logSub(subscription, 'Resubscribe to ' + publication.name);
    } else {
        subscription = new Subscription(user, UUID.generate(), publication, params);
        logSub(subscription, 'New subscription to ' + publication.name + ' ' + JSON.stringify(params));
    }
    activeSubscriptions[subscription.id] = subscription;
    bindSubscriptionToSocket(subscription, socket);
    subscription.emitAllRecords();

    return subscription;
}

/**
 * Unsubscribe a subscription to a publication
 *  
 * @param tenantId: the owner tenant id of the subscription
 * @param userId: the owner id of the subscription
 * @param subscriptionId
 */
function unsubscribe(user, subscriptionId) {
    var subscription = activeSubscriptions[subscriptionId];
    // prevent any other users except the owner to release an existing subscription
    if (subscription && user.id == subscription.userId && user.tenantId === subscription.tenantId) {
        subscription.release();
        // at this point, the subscription is removed from memory with its cache and its pointer;
    }
}

/**
 * Retrieve the active subscriptions
 * 
 * For testing purposes. Later on could be used to define current user activity.
 */
function getActiveSubscriptions() {
    // should only collect indicators from subscription instances.
    return activeSubscriptions;
}

/**
 * 
 * count the current number of active subscriptions
 * 
 * Besides testing, it is a server load indicator.
 */
function countActiveSubscriptions() {
    return Object.keys(activeSubscriptions).length;
}

/**
 * set Max Disconnection Time Before Dropping Subscription
 * 
 * Usually when a client losses the network, it is temporary, 
 * This will prevent from fetching data (access db) if the client reconnects fast enough.
 * This will also improve over all server response time. 
 * 
 * @param valueInSeconds
 * 
 */
function setMaxDisconnectionTimeBeforeDroppingSubscription(valueInSecondes) {
    maxDisconnectionTimeBeforeDroppingSubscription = valueInSecondes;
}

function getMaxDisconnectionTimeBeforeDroppingSubscription() {
    return maxDisconnectionTimeBeforeDroppingSubscription;
}

/**
 * force sync to show debug information
 * 
 */
function setDebug(value) {
    debug = value;
}

/**
 * drop all active subscriptions from this server.
 * 
 * This is used for test purposes.
 */
function clear() {
    _.values(activeSubscriptions).forEach(function (subscription) {
        subscription.release();
    })
}

/**
 * Define a new publication which can be subscribe to.
 * 
 * @param name : the name of the publication the client can subscripbe too
 * @param fetchFn: the function that will return a promise with the array of data pulled. this function will receive the params passed by the subscription if any.
 * @param dataNotification:   currently, this is a single string (not a Class). When data is updated, deleted or added, it should be notified with this value
 * @param options: object with followings:
 *        init: function to provided additional params that will be used to check if a subscription listens to the notified data(new, updated or removed data),
*/
function publish(name, fetchFn, dataNotification, options) {
    if ((!dataNotification || typeof dataNotification !== 'string') && (!options || !options.once)) {
        // without this the subscription would not know when there is a change in a table
        throw (new Error('Missing or incorrect data notification when registering publication [' + name + ']'));
    }
    var publication = {
        name: name,
        fn: fetchFn,
        dataNotifications: [dataNotification] // will enhance later...this will require running the fetch with a timestamp after each notification
    };
    if (options) {
        publication.init = options.init; // option to provide third params
        publication.once = options.once; // will publish only once..then unsubscribe the client
    }
    publications[name] = publication;
    return sync;
}
/**
 * Notify a record changes. 
 * Before notifying, make sure the record revision was increased
 * 
 * @param dataNotification:   string to define the type of object we are notifying and publications are potentially listening to.
 * @param record: Object/record to notify to listening publication
 *  
 * Notes:
 * TO REMOVE!!! Options: {boolean} [forceNotify=false] Notify even if there was no match with the record.
 */
function notifyChanges(dataNotification, record, options) {
    options = options || {}
    notifyCluster(dataNotification, record);

    findPublicationsListeningToDataNotification(dataNotification)
        .forEach(function (publication) {
            findSubscriptionsUsingPublication(publication.name)
                .forEach(function (subscription) {
                    // make sure that the subscription is matching the notification params..so that we don't call the db for nothing!!
                    if (options.forceNotify === true || subscription.checkIfMatch(record)) {
                        //subscription.emitChanges();
                        // but In order to prevent fetching, would need to replace by
                        subscription.emitChange(record);
                        // 
                    }
                })
        });
}

/**
 * Notify a record removal. 
 * Before notifying, make sure the record revision was increased. 
 * 
 * @param dataNotification:   string to define the type of object we are notifying and publications are potentially listening to.
 * @param record: Object/Record to notify to listening publication (must at least have an id and revision number)
 * 
 */
function notifyRemoval(dataNotification, record) {
    record.remove = new Date();
    notifyChanges(dataNotification, record);
}

////////////////// HELPERS //////////////////////
/**
 * The notification should be able to reach any node server related to this tenant
 * Potential users of a tenant might have their socket connected to publication located on other servers.
 * 
 * Note: Other solution might be considered (clustering/ load balancing/ single server capabiblities, etc)
 * 
 * @param dataNotification:   string to define the type of object we are notifying and publications are potentially listening to.
 * @param record: Object/Record to notify to listening publication
 * 
 */
function notifyCluster(dataNotification, record) {
}

/**
 * 
 * Subscription Class
 * 
 * @param user: user object must include the following properties id, tenantId, display 
 * @param subscriptionId: id for this new subscription
 * @param publication: Name of the publication name
 * @param params: a map of key/value to apply to the publication
 * 
 */
function Subscription(user, subscriptionId, publication, params) {
    var additionalParams = {};
    var queue = {};
    var initialPushCompleted;
    var thisSub = this;

    if (!(user && user.tenantId && user.id)) {
        // should never happen...but we are in the process of refactor tenantId...
        throw (new Error('Defect: tenantId or userId is null.'));
    }

    this.id = subscriptionId;

    this.userId = user.id;
    this.tenantId = user.tenantId;

    this.user = user;

    this.params = params;
    this.additionalParams = additionalParams;
    this.publication = publication;
    this.timestamp = 0;
    this.emitAllRecords = emitAllRecords;
    this.emitChange = emitChange;
    this.emitQueue = emitQueue;
    this.checkIfMatch = checkIfMatch;
    this.release = release;



    // this give an opportunity for the publication to set additional parameters that will be use during fetching.
    if (publication.init) {
        publication.init(this.tenantId, this.user, additionalParams);
    }



    //////////////

    /**
     * Retrieved data from persistence storage and push all data to the client.
     *  
     * @returns promise
     */
    function emitAllRecords() {
        // return promise;
        var sub = this;
        initialPushCompleted = false;
        logSub(thisSub, 'Feching all data now');
        return this.publication.fn(sub.tenantId, sub.user, this.params)
            .then(function (result) {
                var records = toArray(result);
                if (!records || records.length == 0) {
                    emitNoDataAtInit();
                } else {
                    records.forEach(addToQueue);
                    emitQueue(true);
                }
                return; // does not return a promise here on purpose (non blocking)
            })
            .catch(function (err) {
                // unrecoverable error... check your fetch code.
                console.error(err.stack);
            })
    }

    function emitNoDataAtInit() {
        thisSub.socket.emit('SYNC_NOW', { name: thisSub.publication.name, subscriptionId: thisSub.id, records: [], params: thisSub.params }, function (response) {
            initialPushCompleted = true;
        });
    }

    function emitQueue(isAllRecords) {
        var recordsToProcess = readQueue();
        if (recordsToProcess.length == 0) {
            logSub(thisSub, 'No data to emit');
            return;
        }

        if (!thisSub.socket) {
            logSub(thisSub, 'Emit canceled. Subscription no longer bound and pending destruction.');
            return;
        }

        logSub(thisSub, 'Emitting data: ' + recordsToProcess.length);
        thisSub.timestamp = getMaxTimestamp(thisSub.timestamp, recordsToProcess);

        thisSub.socket.emit('SYNC_NOW', { name: thisSub.publication.name, subscriptionId: thisSub.id, records: recordsToProcess, params: thisSub.params, diff: !isAllRecords }, function (response) {
            // The client acknowledged. now we are sure that the records were received.
            removeFromQueue(recordsToProcess);

            initialPushCompleted = true;
            // if the publication is supposed to push the data only once...release subscription
            if (thisSub.publication.once) {
                release();
            }
            // otherwise if something was added to the queue meantime...let's process again..
            else if (getQueueLength() > 0) {
                emitQueue();
            }

        });
        return; // does not return a promise here on purpose (non blocking)
    }

    function emitChange(record) {
        addToQueue(record);
        // if there is more than one record currently in the queue...it means client has not gotten all the data yet. Could be due a slow or lost of connection. but...so let's wait it finishes and avoid emitting again.
        // the emitCache function will catch up and try to empty the queue anyway.
        if (initialPushCompleted && getQueueLength() == 1) {
            emitQueue();
        }
    }

    function addToQueue(record) {
        var previous = queue[getIdValue(record.id)];
        // add to queue only if it is a version more recent
        if (!previous || getRecordRevision(previous) !== null || getRecordRevision(previous) < getRecordRevision(record)) {
            queue[getIdValue(record.id)] = record;
        }
    }

    function removeFromQueue(records) {
        records.forEach(function (record) {
            var previous = queue[getIdValue(record.id)];
            if (!previous || getRecordRevision(previous) !== null || getRecordRevision(previous) <= getRecordRevision(record)) {
                // remove record fromo queue only except if there is already a new version more recent (Might just have been notified)
                delete queue[getIdValue(record.id)];
                //logSub(sub, 'Dropping queue to:'+readQueue().length);
            }
        });
    }

    function getIdValue(id) {
        if (!_.isObject(id)) {
            return id;
        }
        // build composite key value
        var r = _.join(_.map(id, function (value) {
            return value;
        }), '~');
        return r;

    }


    function getRecordRevision(record) {
        // what reserved field do we use as timestamp
        // if the object contains a version, let's use it...otherwise it must provide a timestamp (that is set when inserting, updating or deleting from the db)
        if (typeof record.revision !== 'undefined' && record.revision !== null) {
            return record.revision;
        }
        if (typeof record.timestamp !== 'undefined' && record.timestamp !== null) {
            return record.timestamp;
        }
        throw new Error('A revision or timestamp property is required in records to be synced');
    }

    function readQueue() {
        var r = [];
        for (var id in queue) {
            r.push(queue[id]);
        }
        //logSub(sub, 'Read subscription queue:'+r.length);
        return r;
    }

    function getQueueLength() {
        return Object.keys(queue).length;
    }


    function checkIfMatch(dataParams) {
        // if TASK_DATA is notified with object containing(planId:5) and subscription params were for ie: (planId:5, status:'active')
        // the subscription would run the publication.
        return checkIfIncluded(this.params, dataParams) && checkIfIncluded(this.additionalParams, dataParams);
    }

    function checkIfIncluded(keyParams, record) {
        if (!record.id) {
            throw (new Error('Object with no id cannot be synchronized. This is a requirement.'));
        }
        if (!keyParams || Object.keys(keyParams).length === 0) {
            return true
        }
        var matching = true;
        for (var param in keyParams) {
            // are other params matching the data notification?
            // ex: we might have receive a notification about taskId=20 but we are only interested about taskId=3
            if (getIdInMinObjectIfAny(record, param) !== keyParams[param]) {
                matching = false;
                break;
            }
        }
        return matching;
    }

    /**
     * find the id value based on id property name in a record.
     * Ex: the subscription params might be on opportunityId, but account object has no opportunityId but opportunity.id...so get the value there instead.
     * 
     * @param record : object to investigate
     * @param param: id name
     * 
     * @returns id 
     */
    function getIdInMinObjectIfAny(record, param) {
        var p = param.indexOf('Id');
        if (p != -1) {
            var minObject = param.substring(0, p);
            if (record[minObject]) {
                return record[minObject].id;
            }
        }
        return record[param];
    }

    function getMaxTimestamp(timestamp, records) {
        for (var r = 0; r < records.length; r++) {
            if (timestamp < getRecordRevision(records[r])) {
                timestamp = getRecordRevision(records[r]);
            }
        }
        return timestamp;
    }

    function toArray(result) {
        var records;
        if (Object.prototype.toString.call(result) === '[object Array]') {
            records = result;
        } else if (result !== null) {
            records = [result];
        }
        return records;
    }

    /**
     * release the subscription from memory...
     * If the client were to reconnect (after a long period of network of disconnection), a new subscription would be created
     */
    function release() {
        logSub(thisSub, 'Unsubscribed.');
        // ubound socket to this subscription if not done already (disconnect)
        if (thisSub.socket) {
            var i = thisSub.socket.subscriptions.indexOf(thisSub);
            if (i != -1) {
                thisSub.socket.subscriptions.splice(i, 1);
            }
        }
        delete activeSubscriptions[thisSub.id];

    }
}

function findSubscriptionsUsingPublication(publicationName) {
    var r = [];
    for (var id in activeSubscriptions) {
        var subscription = activeSubscriptions[id];
        if (subscription.publication.name === publicationName) {
            r.push(subscription);
        }
    }
    return r;
}

function findPublicationsListeningToDataNotification(dataNotification) {
    var r = [];
    for (var publicationName in publications) {
        if (publications[publicationName].dataNotifications.indexOf(dataNotification) != -1) {
            r.push(publications[publicationName]);
        }
    }
    return r;
}

function findPublicationByName(publicationName) {
    var publication = publications[publicationName];
    if (!publication) {
        throw (new Error('Subscription to inexisting publication [' + publicationName + ']'));
    }
    return publication;
}

function bindSubscriptionToSocket(subscription, socket) {
    subscription.socket = socket;
    // let's track bound subscription so that they can be discarded in case of socket disconnection.
    if (!socket.subscriptions) {
        socket.subscriptions = [];
        unbindAllSubscriptionOnSocketDisconnect(socket);
        socket.subscriptions.push(subscription);;
    } else if (socket.subscriptions.indexOf(subscription) == -1) {
        socket.subscriptions.push(subscription);
    }
}

function unbindAllSubscriptionOnSocketDisconnect(socket) {
    socket.on('disconnect', function () {
        // release socket instance from its subscriptions...
        var socketSubscriptions = socket.subscriptions;
        socket.subscriptions = [];
        socketSubscriptions.forEach(function (subscription) {
            logSub(subscription, 'Unbound due to disconnection.');
            subscription.socket = null;
        });
        // then give a change to reuse the subscription if the client reconnects fast enough, otherwise unsubscribe all subscriptions from this socket.
        setTimeout(function () {
            socketSubscriptions.forEach(function (subscription) {
                // if there is a socket it would be a new one, not the one is disconnected.  so the subscription has been reactivated on the new socket (client reconnected)
                if (!subscription.socket) {
                    logSub(subscription, 'Timeout. Discarding Subscription. No longer in use.');
                    unsubscribe(subscription.user, subscription.id);
                }
            });

        }, maxDisconnectionTimeBeforeDroppingSubscription * 1000);
    });
}

function logSub(subscription, text) {
    if (debug) {
        console.log(subscription.user.display + ': Sub[' + subscription.publication.name + '/id:' + subscription.id + ']: ' + text);
    }
}




