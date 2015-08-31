/* jshint globalstrict: true, unused: false */
/* global cmds: false, TIME: false, DEBUG: false, main: false */
'use strict';

const TIME = 0;

function i32(n: number): number {
	'use strict';

	return n|0;
}

// copied from src/i.ts
interface Table {
	x: number[];
	y: number[];
}

interface TimeSpec {
	start: number;
	stop: number;
	dt: number;
	savestep: number;
}

interface Series {
	name: string;
	time: Float64Array;
	values: Float64Array;
}

interface CalcFn {
	(dt: number, curr: Float64Array): void;
}

interface CalcStocksFn {
	(dt: number, curr: Float64Array, next: Float64Array): void;
}

class Simulation {
	name: string;
	_shift: number;

	parent: Simulation;

	saveEvery: number;
	stepNum: number;
	nVars: number;

	modules: {[name: string]: Simulation};
	symRefs: {[name: string]: string};
	ref: {[name: string]: number};

	initials: {[name: string]: number};
	timespec: TimeSpec;
	offsets: {[name: string]: number};
	tables: {[name: string]: Table};

	slab: Float64Array;

	calcInitial: CalcFn;
	calcFlows: CalcFn;
	calcStocks: CalcStocksFn;

	lookupOffset(id: string): number {
		if (id === 'time')
			return 0;
		if (id[0] === '.')
			id = id.substr(1);
		if (id in this.offsets)
			return this._shift + this.offsets[id];
		let parts = id.split('.');
		if (parts.length === 1 && id === "" && this.name in this.offsets)
			return this._shift + this.offsets[this.name];
		const nextSim = this.modules[parts[0]];
		if (!nextSim)
			return -1;
		return nextSim.lookupOffset(parts.slice(1).join('.'));
	}

	root(): Simulation {
		if (!this.parent)
			return this;
		return this.parent.root();
	}

	resolveAllSymbolicRefs(): void {
		for (let n in this.symRefs) {
			if (!this.symRefs.hasOwnProperty(n))
				continue;
			let ctx: any;
			if (this.symRefs[n][0] === '.') {
				ctx = this.root();
			} else {
				ctx = this.parent;
			}
			this.ref[n] = ctx.lookupOffset(this.symRefs[n]);
		}
		for (let n in this.modules) {
			if (!this.modules.hasOwnProperty(n))
				continue;
			this.modules[n].resolveAllSymbolicRefs();
		}
	}

	varNames(): string[] {
		let result = Object.keys(this.offsets).slice();
		for (let v in this.modules) {
			if (!this.modules.hasOwnProperty(v))
				continue;
			let ids: string[] = [];
			let modVarNames = this.modules[v].varNames();
			for (let n in modVarNames) {
				if (modVarNames.hasOwnProperty(n))
					ids.push(v + '.' + modVarNames[n]);
			}
			result = result.concat(ids);
		}
		if (this.name === 'main')
			result.push('time');

		return result;
	}

	getNVars(): number {
		let nVars = Object.keys(this.offsets).length;
		for (let n in this.modules) {
			if (this.modules.hasOwnProperty(n))
				nVars += this.modules[n].getNVars();
		}
		// if we're main, claim time
		if (this.name === 'main')
			nVars++;
		return nVars;
	}

	reset(): void {
		const timespec = this.timespec;
		const nSaveSteps = i32((timespec.stop - timespec.start)/timespec.savestep + 1);

		this.stepNum = 0;

		this.slab = new Float64Array(this.nVars*(nSaveSteps + 1));

		let curr = this.curr();
		curr[TIME] = timespec.start;
		this.saveEvery = Math.max(1, i32(timespec.savestep/timespec.dt+0.5));

		this.calcInitial(this.timespec.dt, curr);
	}

	runTo(endTime: number): void {
		const dt = this.timespec.dt;

		let curr = this.curr();
		let next = this.slab.subarray(
			(this.stepNum+1)*this.nVars,
			(this.stepNum+2)*this.nVars);

		while (curr[TIME] <= endTime) {
			this.calcFlows(dt, curr);
			this.calcStocks(dt, curr, next);

			next[TIME] = curr[TIME] + dt;

			if (this.stepNum++ % this.saveEvery !== 0) {
				curr.set(next);
			} else {
				curr = next;
				next = this.slab.subarray(
					(i32(this.stepNum/this.saveEvery)+1)*this.nVars,
					(i32(this.stepNum/this.saveEvery)+2)*this.nVars);
			}
		}
	}

	runToEnd(): void {
		return this.runTo(this.timespec.stop + 0.5*this.timespec.dt);
	}

	curr(): Float64Array {
		return this.slab.subarray(
			(this.stepNum)*this.nVars,
			(this.stepNum+1)*this.nVars);
	}

	setValue(name: string, value: number): void {
		const off = this.lookupOffset(name);
		if (off === -1)
			return;
		this.curr()[off] = value;
	}

	value(name: string): number {
		const off = this.lookupOffset(name);
		if (off === -1)
			return;
		const saveNum = i32(this.stepNum/this.saveEvery);
		const slabOff = this.nVars*saveNum;
		return this.slab.subarray(slabOff, slabOff + this.nVars)[off];
	}

	series(name: string): Series {
		const saveNum = i32(this.stepNum/this.saveEvery);
		const time = new Float64Array(saveNum);
		const values = new Float64Array(saveNum);
		const off = this.lookupOffset(name);
		if (off === -1)
			return;
		for (let i = 0; i < time.length; i++) {
			let curr = this.slab.subarray(i*this.nVars, (i+1)*this.nVars);
			time[i] = curr[0];
			values[i] = curr[off];
		}
		return {
			'name': name,
			'time': time,
			'values': values,
		};
	}
}

let cmds: any;

function handleMessage(e: any): void {
	'use strict';

	let id = e.data[0];
	let cmd = e.data[1];
	let args = e.data.slice(2);
	let result: [any, any];

	if (cmds.hasOwnProperty(cmd)) {
		result = cmds[cmd].apply(null, args);
	} else {
		result = [null, 'unknown command "' + cmd + '"'];
	}

	if (!Array.isArray(result))
		result = [null, 'no result for [' + e.data.join(', ') + ']'];

	// TODO(bp) look into transferrable objects
	let msg = [id, result];
	// FIXME: this is a DedicatedWorkerGlobalScope, but TypeScript
	// is clueless.
	(<any>this).postMessage(msg);
}

let desiredSeries: string[] = null;

function initCmds(main: Simulation): any {
	'use strict';

	return {
		'reset': function(): [any, any] {
			main.reset();
			return ['ok', null];
		},
		'set_val': function(name: string, val: number): [any, any] {
			main.setValue(name, val);
			return ['ok', null];
		},
		'get_val': function(...args: string[]): [any, any] {
			let result: {[name: string]: number} = {};
			for (let i = 0; i < args.length; i++)
				result[args[i]] = main.value(args[i]);
			return [result, null];
		},
		'get_series': function(...args: string[]): [any, any] {
			let result: {[name: string]: Series} = {};
			for (let i = 0; i<args.length; i++)
				result[args[i]] = main.series(args[i]);
			return [result, null];
		},
		'run_to': function(time: number): [any, any] {
			main.runTo(time);
			return [main.value('time'), null];
		},
		'run_to_end': function(): [any, any] {
			let result: {[name: string]: Series} = {};
			main.runToEnd();
			if (desiredSeries) {
				for (let i = 0; i < desiredSeries.length; i++)
					result[desiredSeries[i]] = main.series(desiredSeries[i]);
				return [result, null];
			} else {
				return [main.value('time'), null];
			}
		},
		'set_desired_series': function(names: string[]): [any, any] {
			desiredSeries = names;
			return ['ok', null];
		},
	};
}

function lookup(table: any, index: number): number {
	'use strict';

	const size = table.x.length;
	if (size === 0)
		return NaN;

	const x = table.x;
	const y = table.y;

	if (index <= x[0]) {
		return y[0];
	} else if (index >= x[size - 1]) {
		return y[size - 1];
	}

	// binary search seems to be the most appropriate choice here.
	let low = 0;
	let high = size;
	let mid: number;
	while (low < high) {
		mid = Math.floor(low + (high - low)/2);
		if (x[mid] < index) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	let i = low;
	if (x[i] === index) {
		return y[i];
	} else {
		// slope = deltaY/deltaX
		const slope = (y[i] - y[i-1]) / (x[i] - x[i-1]);
		// y = m*x + b
		return (index - x[i-1])*slope + y[i-1];
	}
}

function max(a: number, b: number): number {
	'use strict';

	a = +a;
	b = +b;
	return a > b ? a : b;
}

function min(a: number, b: number): number {
	'use strict';

	a = +a;
	b = +b;
	return a < b ? a : b;
}

function pulse(dt: number, time: number, volume: number, firstPulse: number, interval: number): number {
	'use strict';

	if (time < firstPulse)
		return 0;
	let nextPulse = firstPulse;
	while (time >= nextPulse) {
		if (time < nextPulse + dt) {
			return volume/dt;
		} else if (interval <= 0.0) {
			break;
		} else {
			nextPulse += interval;
		}
	}
	return 0;
}
