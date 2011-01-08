////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;

const DB_FILE_NAME = "firegestures.sqlite";
const BROWSER_ID  = "gesture_mappings";
const BROWSER_URI = "chrome://firegestures/content/browser.rdf";
const VIEWSOURCE_ID  = "viewsource_mapping";
const VIEWSOURCE_URI = "chrome://firegestures/content/viewSource.rdf";
const BUNDLE_URI = "chrome://firegestures/locale/firegestures.properties";

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

// #debug-begin
function log(aMsg) {
	aMsg = aMsg ? " (" + aMsg + ")" : "";
	aMsg = arguments.callee.caller.name + aMsg;
	dump(new Date().toTimeString().substr(0, 8) + "> " + aMsg + "\n");
}

function alert(aMsg) {
	Components.utils.reportError(aMsg);
	var fuelApp = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);
	fuelApp.console.open();
}
// #debug-end


////////////////////////////////////////////////////////////////
// xdGestureService

function xdGestureService() {
	this._initService();
}


xdGestureService.prototype = {

	classDescription: "Mouse Gesture Service",
	contractID: "@xuldev.org/firegestures/service;1",
	classID: Components.ID("{1d26f3e7-d92e-4bcc-ac79-9624bb181308}"),
	QueryInterface: XPCOMUtils.generateQI([
		Ci.nsISupports,
		Ci.xdIGestureService
	]),

	// nsIFile
	_dbFile: null,

	// mozIStorageConnection
	_dbConn: null,

	// key  : id of a mapping
	// value: meta data (RDF datasource URI and name) of the mapping
	_mappingsMeta: {},

	// key  : id of a mapping
	// value: xdIGestureMapping object
	_namedMappings: {},


	// initializes the service
	_initService: function FGS__initService() {
		log();	// #debug
		if (this._dbFile)
			return;
		var dirSvc = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
		this._dbFile = dirSvc.get("ProfD", Ci.nsILocalFile);
		this._dbFile.append(DB_FILE_NAME);
		// register mappings
		this.registerMapping(BROWSER_ID, BROWSER_URI, this.getLocaleString("BROWSER"));
		this.registerMapping(VIEWSOURCE_ID, VIEWSOURCE_URI, this.getLocaleString("VIEWSOURCE"));
	},

	// a wrapper function to create instance of xdIGestureObserver
	createHandler: function FGS_createHandler() {
		var handler = Cc["@xuldev.org/firegestures/handler;1"].createInstance(Ci.xdIGestureHandler);
		return handler;
	},

	// registers a mapping to service for later use
	// @param aID   The id of the mapping to identify it. It must equal to 
	//              the database table name which preserves the user mapping
	// @param aURI  The URI of RDF datasource which preserves the default mapping
	// @param aName The name of the mapping
	registerMapping: function FGS_registerMapping(aID, aURI, aName) {
		if (aID in this._mappingsMeta)
			return;
		this._mappingsMeta[aID] = { uri: aURI, name: aName };
	},

	// returns a registered mapping from service
	// at the first-time calling, creates instance of xdIGestureMapping and initializes it
	// throws NS_ERROR_NOT_INITIALIZED if the mapping is not registered
	getMapping: function FGS_getMapping(aID) {
		if (aID in this._namedMappings)
			return this._namedMappings[aID];
		log(aID);	// #debug
		var meta = this._mappingsMeta[aID];
		if (!meta)
			throw Components.results.NS_ERROR_NOT_INITIALIZED;
		var mapping = Cc["@xuldev.org/firegestures/mapping;1"].createInstance(Ci.xdIGestureMapping);
		mapping.init(aID, meta.uri, meta.name);
		this._namedMappings[aID] = mapping;
		return mapping;
	},

	// a special version of getMapping, which returns the mapping for browser
	getMappingForBrowser: function FGS_getMappingForBrowser() {
		return this.getMapping(BROWSER_ID);
	},

	// returns meta data of all registered mappings
	getMappingsInfo: function FGS_getMappingsInfo() {
		var ret = [];
		for (var id in this._mappingsMeta) {
			var meta = this._mappingsMeta[id];
			ret.push({ id: id, uri: meta.uri, name: meta.name });
		}
		return ret;
	},

	// backups all user mappings to a file
	backupMappings: function FGS_backupMappings(aFile) {
		if (!this._dbFile.exists())
			throw Components.results.NS_ERROR_FAILURE;
		if (aFile.exists())
			aFile.remove(false);
		this._dbFile.copyTo(aFile.parent, aFile.leafName);
	},

	// restores all user mappings from a file
	restoreMappings: function FGS_restoreMappings(aFile) {
		// do not restore from the current database file
		if (aFile.equals(this._dbFile))
			return;
		// close database connection
		if (this._dbConn) {
			this._dbConn.close();
			this._dbConn = null;
		}
		// copy the database file
		if (this._dbFile.exists())
			this._dbFile.remove(false);
		aFile.copyTo(this._dbFile.parent, DB_FILE_NAME);
		// init service again
		this._dbFile = null;
		this._initService();
		// reload all registered mappings if it is already initialized
		for each (var { id: id, uri: uri, name: name } in this.getMappingsInfo()) {
			var mapping = this._namedMappings[id];
			if (mapping) {
				log("reload mapping: " + id);	// #debug
				mapping.finalize();
				mapping.init(id, uri, name);
			}
		}
		// close all options windows
		// XXX if options window opens a modal sub dialog or file picker, cannot close the parent window
		var winMed = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
		var winEnum = winMed.getEnumerator(null);
		while (winEnum.hasMoreElements()) {
			var win = winEnum.getNext().QueryInterface(Ci.nsIDOMWindow);
			if (win.PrefsUI) {
				log("close window: " + (win.name || win.location.href));	// #debug
				// do not save the current mapping in editing when automatically closing window
				win.gShouldCommit = false;
				win.close();
			}
		}
	},

	// returns database connection
	// if aForceOpen is false, returns null if database file doesn't exist
	// if aForceOpen is true, returns connection regardless of the file existence
	getDBConnection: function FGS_getDBConnection(aForceOpen) {
		if (!aForceOpen && !this._dbFile.exists())
			return null;
		if (!this._dbConn || !this._dbConn.connectionReady) {
			log();	// #debug
			var dbSvc = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);
			this._dbConn = dbSvc.openDatabase(this._dbFile);
		}
		return this._dbConn;
	},

	// returns localized string from string bundle
	getLocaleString: function FGS_getLocaleString(aName) {
		if (!this._stringBundle) {
			var bundleSvc = Cc["@mozilla.org/intl/stringbundle;1"].
			                getService(Ci.nsIStringBundleService);
			this._stringBundle = bundleSvc.createBundle(BUNDLE_URI);
		}
		try {
			return this._stringBundle.GetStringFromName(aName);
		}
		catch (ex) {
			alert(ex);	// #debug
			return aName;
		}
	},

	_stringBundle: null,

};


////////////////////////////////////////////////////////////////////////////////
// XPCOM registration

if (XPCOMUtils.generateNSGetFactory)
	// [Firefox4]
	var NSGetFactory = XPCOMUtils.generateNSGetFactory([xdGestureService]);
else
	// [Firefox3.6]
	var NSGetModule = XPCOMUtils.generateNSGetModule([xdGestureService]);


