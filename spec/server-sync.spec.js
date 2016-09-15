var request = require("request");
var sync = require("../lib/server-sync");
var Promise = require('promise');
var base_url = "http://localhost:3000/";
var socket;
var handler;
var userId;
var deferredEmit, deferredFetch;
var emitSocketDisconnect;

var magazine1 = { id: '1', name: 'iron man', revision: 0, type: 'fiction' };
var magazine1b = { id: '1', name: 'IRONMAN', revision: 1, type: 'fiction' };
var magazine2 = { id: '2', name: 'spider man', revision: 7, type: 'fiction' };
var magazine2Deleted = { id: '2', name: 'spider man', revision: 8, type: 'fiction' };
var magazine3 = { id: '3', name: 'Entrepreneur', revision: 9, type: 'business' };
var magazine3b = { id: '3', name: 'The Entrepreneur', revision: 10, type: 'business' };
var magazine3Deleted = { id: '3', name: 'Entrepreneur', revision: 11, type: 'business' };

describe("Sync", function () {
    beforeEach(function () {

        sync.setDebug(true);

        deferredEmit = defer();

        deferredFetch = defer();

        userId = 'UID1234';
        sync.publish(
            'magazines',
            function () {
                deferredFetch.resolve([magazine1, magazine2]);
                return deferredFetch.promise;
            },
            "MAGAZINE_DATA");



        socket = {
            on: function (event, callback) {
                console.log('Socket.on:' + event);
                emitSocketDisconnect = callback;
            },
            emit: function (event, params, callback) {
                console.log('Socket.emit:' + event + '->' + JSON.stringify(params));
                deferredEmit.resolve({ sub: params, acknowledge: callback });
            }
        };

        handler = {
            user: {
                tenantId: 'TID',
                id: userId,
                display: 'John'
            },
            socket: socket
        };

        spyOn(socket, 'emit').and.callThrough();

        jasmine.clock().install();

    });

    afterEach(function () {
        emitSocketDisconnect();
        jasmine.clock().tick(sync.getMaxDisconnectionTimeBeforeDroppingSubscription() * 1000 + 10);
        jasmine.clock().uninstall();
        //        sync.clear();
    });

    it("should subscribe and receive the subscription id", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(sync.countActiveSubscriptions()).toBe(1);
        expect(subId).toBeDefined();

    });

    it("should unsubscribe", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(subId).toBeDefined();
        sync.unsubscribe(userId, subId);
        expect(sync.countActiveSubscriptions()).toBe(0);
    });

    it("should unbound subscription to socket on disconnect but not release the subscription right away", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(subId).toBeDefined();
        emitSocketDisconnect();
        // it is not released right away because the client might restablish the connection and avoid pulling data from db again.
        expect(sync.countActiveSubscriptions()).toBe(1);
    });

    it("should unbound subscription to socket on disconnect and release the subscription later on", function () {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        expect(subId).toBeDefined();
        emitSocketDisconnect();
        jasmine.clock().tick(sync.getMaxDisconnectionTimeBeforeDroppingSubscription() * 500);
        expect(sync.countActiveSubscriptions()).toBe(1);
        jasmine.clock().tick(sync.getMaxDisconnectionTimeBeforeDroppingSubscription() * 500 + 10);
        expect(sync.countActiveSubscriptions()).toBe(0);
    });

    it("should subscribe and receive subscription data", function (done) {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        waitForNotification().then(function (sub) {
            expect(sub.records.length).toBe(2);
            expect(sub.records[0].name).toBe(magazine1.name);
            expect(sub.records[1].name).toBe(magazine2.name);
            done();
        })
    });

    it("should subscribe and receive all data (not a diff)", function (done) {
        var subId = sync.subscribe(handler, null, 'magazines', null);
        waitForNotification().then(function (sub) {
            expect(sub.diff).toBe(false);
            done();
        });
    });
    describe('without subscription params', function () {
        beforeEach(function () {
            subId = sync.subscribe(handler, null, 'magazines', null);
        });
        it("should receive an update", function (done) {
            waitForNotification().then(function (sub1) {
                sync.notifyChanges('MAGAZINE_DATA', magazine1b);
                waitForNotification().then(function (sub2) {
                    expect(sub2.diff).toBe(true);
                    expect(sub2.records.length).toBe(1);
                    done();
                });

            });
        });

        it("should receive an addition", function (done) {
            waitForNotification().then(function (sub1) {
                sync.notifyChanges('MAGAZINE_DATA', magazine3);
                waitForNotification().then(function (sub2) {
                    expect(sub2.diff).toBe(true);
                    expect(sub2.records.length).toBe(1);
                    done();
                });

            });
        });

        it("should receive a removal", function (done) {
            waitForNotification().then(function (sub1) {
                sync.notifyRemoval('MAGAZINE_DATA', magazine2Deleted);
                waitForNotification().then(function (sub2) {
                    expect(sub2.diff).toBe(true);
                    expect(sub2.records.length).toBe(1);
                    done();
                });
            });
        });

        it("should receive a removal whichever the record removal revision is", function (done) {
            waitForNotification().then(function (sub1) {
                // the client decides if its cache need to remove magazine revision number
                // server does not keep track of what is on the client
                sync.notifyRemoval('MAGAZINE_DATA', magazine2);
                waitForNotification().then(function (sub2) {
                    expect(sub2.records.length).toBe(1);
                    done();
                });
            });
        });
    });

    describe('with subscription params', function () {

        beforeEach(function () {
            subId = sync.subscribe(handler, null, 'magazines', { type: 'fiction' });
        })

        it("should NOT notified the addition unrelated to subscription", function (done) {
            deferredFetch.promise
                .then(function () {
                    expect(socket.emit.calls.count()).toBe(1);
                })
                .then(waitForNotification)
                .then(function (sub1) {
                    sync.notifyChanges('MAGAZINE_DATA', magazine3);
                    expect(socket.emit.calls.count()).toBe(1);
                    done();
                });


        });

        it("should NOT notified the update unrelated to subscription", function (done) {
            deferredFetch.promise
                .then(function () {
                    expect(socket.emit.calls.count()).toBe(1);
                })
                .then(waitForNotification)
                .then(function (sub1) {
                    sync.notifyChanges('MAGAZINE_DATA', magazine3b);
                    expect(socket.emit.calls.count()).toBe(1);
                    done();
                });
        });


        it("should NOT notified the removal unrelated to subscription", function (done) {
            deferredFetch.promise
                .then(function () {
                    expect(socket.emit.calls.count()).toBe(1);
                })
                .then(waitForNotification)
                .then(function (sub1) {
                    debugger
                    sync.notifyChanges('MAGAZINE_DATA', magazine3Deleted);
                    expect(socket.emit.calls.count()).toBe(1);
                    done();
                });


        });
    });


    // it("returns status code 200", function (done) {
    //     done();
    // });
    // describe("GET /", function () {
    //     it("returns status code 200", function (done) {
    //         request.get(base_url, function (error, response, body) {
    //             expect(response.statusCode).toBe(200);
    //             done();
    //         });
    //     });

    //     it("returns Hello World", function (done) {
    //         request.get(base_url, function (error, response, body) {
    //             expect(body).toBe("Hello World");
    //             done();
    //         });
    //     });
    // });

    function waitForNotification() {
        return deferredEmit.promise.then(function (data) {
            deferredEmit = defer();
            data.acknowledge();
            return data.sub;
        })
    }

    function defer() {
        var deferred = {};
        deferred.promise = new Promise(function (resolve, reject) {
            deferred.resolve = resolve;
        });
        return deferred;
    }

});