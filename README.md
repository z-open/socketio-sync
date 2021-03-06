# socketio-sync



### Scope

This node module handles the data synchronization on the server side over socket connection.


### pre-requisite

socketio-auth middleware
First, set up your node server to use express with socketio-auth.

Angular-sync client
It requires the client to use the angular-sync bower package to establish the syncing process.


### Principle

Client subscribes to a publication defined on the backend.
When the subscription is established, the backend subscription will fetch data from the db and send them to the subscribers.

When data is updated in the backend, a notification must be implemented to emit the data/object change.
Publications react to those notifications. They will directly push the changes to their subscribers if determined to be related.

The idea is to decrease the number of accesses to the db:

- In most cases, the publication only needs to access the persistence layer at initialization.
- If the connection to the subscribers is lost for a short period of time, the publication caches next changes and give enough time for the client to reconnect.
- If connection is lost for a long time, the cache will be released. At its reconnection, client will get a new subscription that will fetch data from the db.

NOTE: 
The client MUST reconnect on the same node server to get what is the queue for an existing subscription...otherwise it will resubscribe on the new node server and fetch all data.
This might be taken in consideration when implementing a load balancing strategy.


### Example

Create a publication on the backend. the publication is set to listen to data changes
 ex:
  sync.publish('magazines.sync',function(tenantId,userId,params){
    return magazineService.fetchForUser(userId,params.type)
 },[MAGAZINE_DATA]);
 }
 
 Subscribe to this publication on the client (In this example, it is a subscription to an array)
 ex:

 var sync = require("socketio-sync")
 var sds = sync.subscribe(
            'magazines',
            scope).setParameters({ type: 'fiction'});
var mySyncList = sds.getData();
 
 When your api update, create or remove data, notify the data changes on the backend. You might provide params that must be in the subscription to react. 
 ex:

 var sync = require("socketio-sync")
 function createMagazine(magazine) {
    magazine.revision = 0;
    return saveInDb(magazine).then(function (magazine) {
        sync.notifyChanges('MAGAZINE_DATA', magazine);
        return magazine
    });
 }

 function updateMagazine(magazine) {
    magazine.revision++;
    return saveInDb(magazine).then(function (magazine) {
        sync.notifyChanges('MAGAZINE_DATA', magazine);
        return magazine
    });
 }
 
 function removeMagazine(magazine) {
    magazine.revision++;
    return removeFromDb(magazine).then(function (rep) {
        sync.notifyRemoval('MAGAZINE_DATA', magazine);
        return rep;
    });
 }

### Other

sync.setMaxDisconnectionTimeBeforeDroppingSubscription

By default, if the client does not restablish the connection in less than 20s, the server will drop the subscription and create a new one (fetching data from db) whehn the client reconnects.

sync.setDebug

by default, the backend does not show the log

### Collaborate

to run the test: npm test


Note: you might increase constant CURRENT_SYNC_VERSION to prevent incompatible bower client libraries to operate.


###To Implement

object property change notification.

Publication shall have an option to be notified not only on object changes but even more precisely to the property level.
Then a publication shall only push an object to its subscribers when some specific object properties have changed.
This will reduce network activity and increase performance.


Composite publication

In order to garantee that a client has related objects/data available before its use, publication shall be able to let the client know when the data is ready for consumption.

Currently if the client subscribes to 2 publications, ex book list publication and publication of authors related to the book list.
if a new book is pushed to the client, the client might try to look up the related author before it is  actually been pushed to the client. This could lead to wrong display or business logic issues.

One publication shall be able to send multiple named recordsets at once. 
There shall be a parent to children relationship between recordsets defined in the publication. Child can also have their own children datasets. 
If a parent is updated/added/removed, the child data should reflect the changes. Grand children might be impacted too. If a notification related to child data is emitted, the publication might push the changes if determined to be related (tracked relationshipsÏ).


