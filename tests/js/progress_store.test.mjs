import assert from "node:assert/strict";
import test from "node:test";

import {createProgressStore} from "../../web/js/progress_store.js";


const STORAGE_KEY = "palmap.progress.v1";
const ID_A = "EnZc1kqJ";
const ID_B = "abc_DEF-";


class FakeStorage
{
    constructor(value = null)
    {
        this.value = value;
        this.get_count = 0;
        this.set_count = 0;
        this.throw_on_get = false;
        this.throw_on_set = false;
    }

    getItem(key)
    {
        assert.equal(key, STORAGE_KEY);
        ++this.get_count;
        if(this.throw_on_get)
        {
            throw new DOMException("denied", "SecurityError");
        }
        return this.value;
    }

    setItem(key, value)
    {
        assert.equal(key, STORAGE_KEY);
        ++this.set_count;
        if(this.throw_on_set)
        {
            throw new DOMException("full", "QuotaExceededError");
        }
        this.value = value;
    }
}


function stored(ids, version = 1)
{
    return JSON.stringify({
        schema_version: version,
        completed_poi_ids: ids,
    });
}


test("absent storage starts empty and persistent without writing", () =>
{
    const storage = new FakeStorage();
    const store = createProgressStore({storage, event_target: null});
    assert.deepEqual([...store.completedIds()], []);
    assert.equal(store.persistenceMode(), "persistent");
    assert.equal(storage.get_count, 1);
    assert.equal(storage.set_count, 0);
});


test("valid storage restores all syntactically valid IDs", () =>
{
    const store = createProgressStore({
        storage: new FakeStorage(stored([ID_A, ID_B])),
        event_target: null,
    });
    assert.deepEqual([...store.completedIds()], [ID_A, ID_B]);
    assert(store.isCompleted(ID_A));
    const snapshot = store.completedIds();
    snapshot.clear();
    assert(store.isCompleted(ID_A));
});


test("invalid and unsupported storage is preserved", () =>
{
    for(const value of ["{", stored([], 2)])
    {
        const storage = new FakeStorage(value);
        const warnings = [];
        const store = createProgressStore({
            storage,
            event_target: null,
            onWarning: (message) => warnings.push(message),
        });
        assert.equal(store.persistenceMode(), "incompatible");
        store.setCompleted(ID_A, true);
        assert(store.isCompleted(ID_A));
        assert.equal(storage.value, value);
        assert.equal(storage.set_count, 0);
        assert.equal(warnings.length, 1);
    }
});


test("storage read failure starts volatile", () =>
{
    const storage = new FakeStorage();
    storage.throw_on_get = true;
    const warnings = [];
    const store = createProgressStore({
        storage,
        event_target: null,
        onWarning: (message) => warnings.push(message),
    });
    assert.equal(store.persistenceMode(), "volatile");
    store.setCompleted(ID_A, true);
    assert(store.isCompleted(ID_A));
    assert.equal(storage.set_count, 0);
    assert.equal(warnings.length, 1);
});


test("setCompleted persists and emits exact changes", () =>
{
    const storage = new FakeStorage();
    const store = createProgressStore({storage, event_target: null});
    const events = [];
    store.subscribe((event) => events.push(event));
    store.setCompleted(ID_A, true);
    store.setCompleted(ID_A, true);
    store.setCompleted(ID_B, true);
    store.setCompleted(ID_A, false);
    assert.equal(storage.set_count, 3);
    assert.deepEqual(events.map((event) => [...event.changed_ids]), [
        [ID_A], [ID_B], [ID_A],
    ]);
    assert.deepEqual([...store.completedIds()], [ID_B]);
    assert.equal(events[0].source, "local");
    events[0].completed_ids.clear();
    assert(store.isCompleted(ID_B));
});


test("setItem failure retains session state and becomes volatile", () =>
{
    const storage = new FakeStorage();
    storage.throw_on_set = true;
    const warnings = [];
    const store = createProgressStore({
        storage,
        event_target: null,
        onWarning: (message) => warnings.push(message),
    });
    store.setCompleted(ID_A, true);
    store.setCompleted(ID_B, true);
    assert.deepEqual([...store.completedIds()], [ID_A, ID_B]);
    assert.equal(store.persistenceMode(), "volatile");
    assert.equal(storage.set_count, 1);
    assert.equal(warnings.length, 1);
});


test("replacement overwrites incompatible state and emits a difference", () =>
{
    const storage = new FakeStorage("invalid");
    const store = createProgressStore({storage, event_target: null});
    store.setCompleted(ID_A, true);
    const events = [];
    store.subscribe((event) => events.push(event));
    store.replace([ID_B]);
    assert.equal(store.persistenceMode(), "persistent");
    assert.deepEqual([...events[0].changed_ids], [ID_A, ID_B]);
    assert.equal(events[0].source, "import");
    assert.deepEqual([...store.completedIds()], [ID_B]);
    assert.equal(storage.set_count, 1);
});


test("storage events replace state without writing", () =>
{
    const storage = new FakeStorage(stored([ID_A]));
    const event_target = new EventTarget();
    const store = createProgressStore({storage, event_target});
    const events = [];
    store.subscribe((event) => events.push(event));
    const event = new Event("storage");
    Object.defineProperties(event, {
        key: {value: STORAGE_KEY},
        newValue: {value: stored([ID_B])},
        storageArea: {value: storage},
    });
    event_target.dispatchEvent(event);
    assert.deepEqual([...store.completedIds()], [ID_B]);
    assert.equal(storage.set_count, 0);
    assert.equal(events[0].source, "storage");

    const clear_event = new Event("storage");
    Object.defineProperties(clear_event, {
        key: {value: STORAGE_KEY},
        newValue: {value: null},
        storageArea: {value: storage},
    });
    event_target.dispatchEvent(clear_event);
    assert.deepEqual([...store.completedIds()], []);
});


test("invalid storage events are ignored and warned", () =>
{
    const storage = new FakeStorage(stored([ID_A]));
    const event_target = new EventTarget();
    const warnings = [];
    const store = createProgressStore({
        storage,
        event_target,
        onWarning: (message) => warnings.push(message),
    });
    const event = new Event("storage");
    Object.defineProperties(event, {
        key: {value: STORAGE_KEY},
        newValue: {value: "{"},
        storageArea: {value: storage},
    });
    event_target.dispatchEvent(event);
    assert.deepEqual([...store.completedIds()], [ID_A]);
    assert.equal(warnings.length, 1);
});


test("a valid equal storage event recovers incompatible mode", () =>
{
    const storage = new FakeStorage("invalid");
    const event_target = new EventTarget();
    const store = createProgressStore({storage, event_target});
    const events = [];
    store.subscribe((event) => events.push(event));
    const event = new Event("storage");
    Object.defineProperties(event, {
        key: {value: STORAGE_KEY},
        newValue: {value: stored([])},
        storageArea: {value: storage},
    });
    event_target.dispatchEvent(event);
    assert.equal(store.persistenceMode(), "persistent");
    assert.equal(events.length, 1);
    assert.deepEqual([...events[0].changed_ids], []);
});


test("unsubscribe and dispose stop notifications", () =>
{
    const storage = new FakeStorage();
    const event_target = new EventTarget();
    const store = createProgressStore({storage, event_target});
    let notifications = 0;
    const unsubscribe = store.subscribe(() => ++notifications);
    store.setCompleted(ID_A, true);
    unsubscribe();
    store.setCompleted(ID_B, true);
    store.dispose();
    store.setCompleted(ID_A, false);
    assert.equal(notifications, 1);
});
