// Copyright 2013 Bobby Powers. All rights reserved.
// Use of this source code is governed by the MIT
// license that can be found in the LICENSE file.

import common = require('./common');
import type = require('./type');
import util = require('./util');
import model = require('./model');
import vars = require('./vars');
import jxon = require('./jxon');
import compat = require('./compat');

'use strict';

// TODO(bp) macro support/warnings

export class Project implements type.Project {
	name: string;
	main: type.Module;
	valid: boolean;
	xmile: any;
	timespec: type.TimeSpec;
	models: type.ModelSet;

	constructor(xmileDoc: any) {
		common.err = null;

		if (!xmileDoc || xmileDoc.getElementsByTagName('parsererror').length !== 0) {
			common.err = common.errors.ERR_VERSION;
			this.valid = false;
			return;
		}

		// in Chrome/Firefox, item 0 is xmile.  Under node's XML DOM
		// item 0 is the <xml> prefix.  And I guess there could be
		// text nodes in there, so just explictly look for xmile
		let iNode: number;
		for (iNode = 0; iNode < xmileDoc.childNodes.length &&
			xmileDoc.childNodes.item(iNode).tagName !== 'xmile'; iNode++);

		let xmile = jxon.build(xmileDoc.childNodes.item(iNode));

		if (!(xmile.model instanceof Array))
			xmile.model = [xmile.model];

		for (let v in compat.vendors) {
			if (!compat.vendors.hasOwnProperty(v))
				continue;

			if (compat.vendors[v].match(xmile))
				xmile = compat.vendors[v].translate(xmile);
		}

		this.xmile = xmile;
		if (typeof xmile.header.name === 'string') {
			this.name = xmile.header.name;
		} else {
			this.name = 'main project';
		}

		// get our time info: start-time, end-time, dt, etc.
		this.timespec = xmile.sim_specs;
		if (!this.timespec) {
			this.valid = false;
			return;
		}
		util.normalizeTimespec(this.timespec);

		this.models = {};

		for (let i = 0; i < xmile.model.length; i++) {
			let mdl = xmile.model[i];
			if (!mdl['@name'])
				mdl['@name'] = 'main';
			this.models[mdl['@name']] = new model.Model(this, mdl);
		}
		this.main = new vars.Module(this, null, {'@name': 'main'});
		this.valid = true;
	}

	model(name: string): any {
		if (!name)
			name = 'main';
		return this.models[name];
	}
}