////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

const TYPE_CATEGORY = Ci.xdIGestureMapping.TYPE_CATEGORY;
const TYPE_NORMAL   = Ci.xdIGestureMapping.TYPE_NORMAL;
const TYPE_SCRIPT   = Ci.xdIGestureMapping.TYPE_SCRIPT;

const RDF_NS   = "http://www.xuldev.org/firegestures-mapping#";
const RDF_ROOT = "urn:mapping:root";
const BROWSER_ID = "gesture_mappings";
const WINDOW_TYPE = "FireGestures:Options";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function alert(aMsg) {
	Cu.reportError(aMsg);
	var fuelApp = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);
	fuelApp.console.open();
}


////////////////////////////////////////////////////////////////
// xdGestureMapping

function xdGestureMapping() {}


xdGestureMapping.prototype = {

	classDescription: "Mouse Gesture Mapping",
	contractID: "@xuldev.org/firegestures/mapping;1",
	classID: Components.ID("{d7018e80-d6da-4cbc-b77f-8dca4d95bbbf}"),
	QueryInterface: XPCOMUtils.generateQI([
		Ci.nsISupports,
		Ci.xdIGestureMapping
	]),

	// nsIRDFService
	get rdfSvc() {
		var svc = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
		this.__defineGetter__("rdfSvc", function() svc);
		return this.rdfSvc;
	},

	// the id of mapping, which equals to the table name
	id: null,

	// the name of the mapping
	name: null,

	// nsIRDFDataSource which holds the default mapping
	_dataSource: null,

	// key: direction, value: xdIGestureCommand object
	_mapping: null,

	// alias of xdIGestureService::getDBConnection
	_getDBConnection: null,

	// #debug-begin
	log: function(aMsg) {
		aMsg = aMsg ? " (" + aMsg + ")" : "";
		aMsg = arguments.callee.caller.name + aMsg;
		dump(new Date().toTimeString().substr(0, 8) + "> " + "[" + this.id + "] " + aMsg + "\n");
	},
	// #debug-end

	// initializes mapping
	// throws NS_ERROR_ALREADY_INITIALIZED if |init| is called twice.
	// throws NS_ERROR_ILLEGAL_VALUE       if |aID| is an invalid string.
	// throws NS_ERROR_INVALID_POINTER     if |aURI| is null.
	// throws NS_ERROR_MALFORMED_URI       if |aURI| is an invalid URI.
	// throws NS_ERROR_FAILURE             if |aURI| doesn't contain a RDF.
	init: function FGM_init(aID, aURI, aName) {
		if (this._dataSource)
			throw Cr.NS_ERROR_ALREADY_INITIALIZED;
		if (!/^\w+$/.test(aID))
			throw Cr.NS_ERROR_ILLEGAL_VALUE;
		this.id = aID;
		this.name = aName;
		var gestureSvc = Cc["@xuldev.org/firegestures/service;1"].getService(Ci.xdIGestureService);
		this._getDBConnection = gestureSvc.getDBConnection;
		try {
			this._dataSource = this.rdfSvc.GetDataSourceBlocking(aURI);
		}
		catch(ex) {
			alert("FireGestures: An error occurred while parsing gesture mapping.\n\n" + ex);
			throw ex;
		}
		this.log();	// #debug
		this._reloadMapping();
	},

	_ensureInit: function FGM__ensureInit() {
		if (!this._dataSource)
			throw Cr.NS_ERROR_NOT_INITIALIZED;
	},

	// finalizes mapping
	finalize: function FGM_finalize() {
		this.log();	// #debug
		if (this._dataSource)
			this.rdfSvc.UnregisterDataSource(this._dataSource);
		this.id   = null;
		this.name = null;
		this._dataSource = null;
		this._mapping    = null;
	},

	_reloadMapping: function FGM__reloadMapping() {
		this._mapping = null;
		this._getUserMapping() || this._getDefaultMapping();
		// this._dumpMapping();	// #debug
	},

	// obtain user mapping
	// returns true if succeed to get user mapping
	//         false if failes to get user mapping since the db file doesn't exist.
	_getUserMapping: function FGM__getUserMapping() {
		this._ensureInit();
		var dbConn = this._getDBConnection(false);
		if (!dbConn || !dbConn.tableExists(this.id))
			return false;	// no user mapping
		this.log();	// #debug
		this._mapping = {};
		var stmt = dbConn.createStatement("SELECT * FROM " + this.id);
		try {
			while (stmt.executeStep()) {
				var type      = stmt.getInt32(0);
				var name      = stmt.getUTF8String(1);
				var command   = stmt.getUTF8String(2);
				var direction = stmt.getUTF8String(3);
				// exclude inactive gesture
				if (!command || !direction)
					continue;
				if (type != TYPE_SCRIPT)
					name = this._getLocalizedNameForCommand(command);
				// add command to mapping
				this._mapping[direction] = new xdGestureCommand(type, name, command);
			}
		}
		catch(ex) { Cu.reportError(ex); }
		finally { stmt.reset(); stmt.finalize(); }
		// in case that updating add-on, find resource which has FG:extra property, 
		// and set default mapping for swipe gestures.
		var swipes = ["swipe-left", "swipe-right", "swipe-up", "swipe-down"];
		if (swipes.every(function(swipe) this._mapping[swipe] === undefined, this)) {
			this.log("*** set default mapping for swipe gestures");	// #debug
			swipes.forEach(function(swipe) {
				var prop    = this.rdfSvc.GetResource(RDF_NS + "extra");
				var target  = this.rdfSvc.GetLiteral(swipe);
				var res     = this._dataSource.GetSource(prop, target, true);
				var command = res.Value.substr(("urn:").length);
				var name    = this._getLocalizedNameForCommand(command);
				this._mapping[swipe] = new xdGestureCommand(TYPE_NORMAL, name, command);
				this.log([swipe, command, name].join("\t"));	// #debug
			}, this);
		}
		return true;
	},

	// obtain default mapping
	_getDefaultMapping: function FGM__getDefaultMapping() {
		this._ensureInit();
		this.log(this._dataSource.URI);	// #debug
		this._mapping = {};
		var rdfCont = Cc["@mozilla.org/rdf/container;1"].createInstance(Ci.nsIRDFContainer);
		rdfCont.Init(this._dataSource, this.rdfSvc.GetResource(RDF_ROOT));
		var resEnum = rdfCont.GetElements();
		while (resEnum.hasMoreElements()) {
			var res = resEnum.getNext().QueryInterface(Ci.nsIRDFResource);
			var type      = parseInt(this._getPropertyValue(res, "type"), 10);
			var name      = this._getPropertyValue(res, "name");
			var command   = res.Value.substr(("urn:").length);
			var direction = this._getPropertyValue(res, "direction");
			var extra     = this._getPropertyValue(res, "extra");
			// exclude category and inactive gesture
			if (type == TYPE_CATEGORY || (!direction && !extra))
				continue;
			// add command to mapping
			this._mapping[direction] = new xdGestureCommand(type, name, command);
			if (extra)
				this._mapping[extra] = new xdGestureCommand(type, name, command);
		}
	},

	_getLocalizedNameForCommand: function FGM__getLocalizedNameForCommand(aCommand) {
		var res = this.rdfSvc.GetResource("urn:" + aCommand);
		return this._getPropertyValue(res, "name");
	},

	_getPropertyValue: function FGM__getPropertyValue(aRes, aProp) {
		aProp = this.rdfSvc.GetResource(RDF_NS + aProp);
		try {
			var target = this._dataSource.GetTarget(aRes, aProp, true);
			return target ? target.QueryInterface(Ci.nsIRDFLiteral).Value : null;
		}
		catch(ex) {
			alert("*** _getPropertyValue(" + aRes.Value + ", " + aProp.Value + ") " + ex);	// #debug
			return null;
		}
	},

	// #debug-begin
	_dumpMapping: function FGM__dumpMapping() {
		dump("---\n");
		for (var direction in this._mapping) {
			var command = this._mapping[direction];
			dump([
				direction, command.type, 
				command.value.replace(/\r|\n|\t/g, " ").substr(0, 100), 
				command.name
			].join("\t") + "\n");
		}
		dump("---\n");
	},
	// #debug-end

	// returns xdIGestureCommand object for given direction
	// returns undefined if there are no definition for the given direction
	getCommandForDirection: function FGM_getCommandForDirection(aDirection) {
		return this._mapping[aDirection];
	},

	// opens options window to configure mapping
	configure: function FGS_configure() {
		var browser = this.id == BROWSER_ID;
		var type = browser ? WINDOW_TYPE : WINDOW_TYPE + ":" + this.id;
		var winMed = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
		var win = winMed.getMostRecentWindow(type);
		if (win) {
			win.focus();
			win.document.documentElement.showPane(win.document.getElementById("mappingPane"));
			return;
		}
		var url = browser ? "chrome://firegestures/content/prefs.xul" : 
		                    "chrome://firegestures/content/prefs-generic.xul";
		var features = "chrome,titlebar,toolbar,centerscreen,resizable,dialog=no";
		win = winMed.getMostRecentWindow(null);
		if (browser)
			win.openDialog(url, type, features);
		else
			win.openDialog(url, type, features, this.id);
	},

	// returns arrayfied mapping
	getMappingArray: function FGM_getMappingArray() {
		this._ensureInit();
		this.log();	// #debug
		var items = [];
		var dbConn = this._getDBConnection(false);
		if (!dbConn || !dbConn.tableExists(this.id))
			dbConn = null;
		var rdfCont = Cc["@mozilla.org/rdf/container;1"].createInstance(Ci.nsIRDFContainer);
		rdfCont.Init(this._dataSource, this.rdfSvc.GetResource(RDF_ROOT));
		var resEnum = rdfCont.GetElements();
		while (resEnum.hasMoreElements()) {
			var res = resEnum.getNext().QueryInterface(Ci.nsIRDFResource);
			var type    = parseInt(this._getPropertyValue(res, "type"), 10);
			var name    = this._getPropertyValue(res, "name");
			var command = res.Value.substr("urn:".length);
			var flags   = this._getPropertyValue(res, "flags");
			// if user mapping exists, get the user-defined gesture
			if (dbConn && type == TYPE_NORMAL) {
				var directions = [];
				var stmt = dbConn.createStatement("SELECT direction FROM " + this.id + " WHERE command = ?");
				stmt.bindUTF8StringParameter(0, command);
				try {
					while (stmt.executeStep())
						directions.push(stmt.getUTF8String(0));
				}
				catch(ex) { Cu.reportError(ex); }
				finally { stmt.reset(); stmt.finalize(); }
				// if command is not assigned normal mouse gesture, add it as non-gesture-assigned item
				if (!directions.some(function(direction) { return /^[LRUD]*$/.test(direction); }))
					directions.unshift("");
				for (let direction of directions)
					items.push([type, name, command, direction, flags]);
			}
			// if user mapping does not exist, get the default gesture
			else {
				var direction = this._getPropertyValue(res, "direction") || "";
				var extra     = this._getPropertyValue(res, "extra");
				items.push([type, name, command, direction, flags]);
				if (extra)
					items.push([type, name, command, extra, flags]);
			}
		}
		// user script
		if (dbConn) {
			var sql = "SELECT name, command, direction FROM " + this.id + " WHERE type = " + TYPE_SCRIPT;
			var stmt = dbConn.createStatement(sql);
			try {
				while (stmt.executeStep()) {
					items.push([
						TYPE_SCRIPT, stmt.getUTF8String(0), stmt.getUTF8String(1), stmt.getUTF8String(2), null
					]);
				}
			}
			catch(ex) { Cu.reportError(ex); }
			finally { stmt.reset(); stmt.finalize(); }
		}
		return items;
	},

	// flushes user mapping to local disk
	// @param aItems is arrayfied of mapping
	// @throws NS_ERROR_FAILURE if the file access is denied
	saveUserMapping: function FGM_saveUserMapping(aItems) {
		this._ensureInit();
		this.log();	// #debug
		var dbConn = this._getDBConnection(true);
		dbConn.executeSimpleSQL("DROP TABLE IF EXISTS " + this.id);
		dbConn.createTable(this.id, "type INTEGER, name TEXT, command TEXT, direction TEXT");
		dbConn.beginTransaction();
		for (let [type, name, command, direction] of aItems) {
			// put the following items to database
			// * normal commands which have gesture and command
			// * script-type commands
			// don't put the following items
			// * category
			// * normal commands which are not assigned gesture
			if (type == TYPE_CATEGORY || (type == TYPE_NORMAL && (!direction || !command)))
				continue;
			var stmt = dbConn.createStatement("INSERT INTO " + this.id + " VALUES(?,?,?,?)");
			stmt.bindInt32Parameter(0, type);
			stmt.bindUTF8StringParameter(1, type == TYPE_SCRIPT ? name : "");
			stmt.bindUTF8StringParameter(2, command);
			stmt.bindUTF8StringParameter(3, direction);
			try {
				stmt.execute();
			}
			catch(ex) { Cu.reportError(ex); }
			finally { stmt.reset(); stmt.finalize(); }
		}
		dbConn.commitTransaction();
		this._reloadMapping();
	},

	// API for third-party extensions to add script-type commands
	// @param aItems Array of JavaScript object which has the following properties:
	//               name     : name of the command
	//               script   : script of the command
	//               direction: default normal gesture to be assigned to the command (e.g. "LRUD")
	addScriptCommands: function FGM_addScriptCommands(aItems) {
		this._ensureInit();
		var added = false;
		var items = this.getMappingArray();
		outer: for (let aItem of aItems) {
			// do not overwrite an existing gesture
			if (this.getCommandForDirection(aItem.direction))
				aItem.direction = "";
			// avoid duplication
			inner: for (let [ type, , script, ] of items) {
				if (type != TYPE_SCRIPT)
					continue inner;
				if (script == aItem.script)
					continue outer;
			}
			items.push([TYPE_SCRIPT, aItem.name, aItem.script, aItem.direction, null]);
			added = true;
			this.log(aItem.toSource());	// #debug
		}
		if (!added)
			return;
		this.saveUserMapping(items);
		this._reloadMapping();
	},

};


////////////////////////////////////////////////////////////////
// xdGestureCommand

function xdGestureCommand(aType, aName, aCommand, aDirection) {
	this.type = aType;
	this.name = aName;
	this.value = aCommand;
	this.direction = aDirection;
}

xdGestureCommand.prototype = {
	QueryInterface: function(aIID) {
		if (!aIID.equals(Ci.nsISupports) && 
		    !aIID.equals(Ci.xdIGestureCommand)) {
			throw Cr.NS_ERROR_NO_INTERFACE;
		}
		return this;
	}
};


////////////////////////////////////////////////////////////////////////////////
// XPCOM registration

var NSGetFactory = XPCOMUtils.generateNSGetFactory([xdGestureMapping]);


