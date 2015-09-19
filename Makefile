
REQUIRE   ?= node_modules/.bin/r.js
BOWER     ?= node_modules/.bin/bower
TSLINT    ?= node_modules/.bin/tslint
TSC       ?= node_modules/.bin/tsc
MOCHA     ?= node_modules/.bin/mocha

ALMOND     = bower_components/almond
QJS        = bower_components/q/q.js
MUSTACHEJS = bower_components/mustache.js/mustache.js
HAMMERJS   = bower_components/hammerjs/hammer.js

TSFLAGS    = -t es5 --noImplicitAny --removeComments

RUNTIME    = src/runtime.ts
# ensure runtime is only listed once
LIB_SRCS   = $(filter-out $(RUNTIME), $(wildcard src/*.ts)) $(RUNTIME)
RT_SRCS    = $(wildcard runtime/*.ts)
TEST_SRCS  = $(wildcard test/*.ts)

TEST       = test/.stamp

LIB        = sd.js
LIB_MIN    = sd.min.js

TARGETS    = $(LIB) $(LIB_MIN) lib
# make sure we recompile when the Makefile (and associated
# CFLAGS/LDFLAGS change) or any project files are changed.
CONFIG     = Makefile $(TSC) $(BOWER) $(TSLINT) $(REQUIRE) build.js \
	$(shell find typings -name '*.d.ts')

RTEST_DIR  = test/test-models
RTEST_CMD  = $(RTEST_DIR)/regression-test.py

QUIET_RJS  =

# quiet output, but allow us to look at what commands are being
# executed by passing 'V=1' to make, without requiring temporarily
# editing the Makefile.
ifneq ($V, 1)
MAKEFLAGS += -s
QUIET_RJS  = >/dev/null
endif

# GNU make, you are the worst.
.SUFFIXES:
%: %,v
%: RCS/%,v
%: RCS/%
%: s.%
%: SCCS/s.%


all: $(TARGETS)

node_modules: package.json
	@echo "  NPM"
	npm install --silent
	touch -c $@

$(TSC) $(BOWER) $(TSLINT) $(REQUIRE): node_modules
	touch -c $@

bower_components: $(BOWER) bower.json
	@echo "  BOWER"
	$(BOWER) install --silent
	touch -c $@

$(ALMOND): bower_components
	touch -c $@

# AMD-based browser/requirejs target
build: $(LIB_SRCS) $(CONFIG) bower_components
	@echo "  TS    $@"
	$(TSLINT) -c .tslint.json $(LIB_SRCS)
	$(TSC) $(TSFLAGS) -m amd --outDir build $(LIB_SRCS)
	cp -a $(MUSTACHEJS) $(QJS) $(HAMMERJS) $@
	cp -a $@/hammer.js $@/Hammer.js
	touch $@

build-rt: $(RT_SRCS) $(CONFIG)
	@echo "  TS    $@"
	$(TSLINT) -c .tslint.json $(RT_SRCS)
	$(TSC) $(TSFLAGS) -m commonjs --outDir build-rt $(RT_SRCS)
	touch $@

$(RUNTIME): build-rt ./build-runtime.py
	@echo "  RT    $@"
	./build-runtime.py >$@

# commonjs-based node target.  JS is an endless sea of sadness - we
# need to run tsc twice, once for node's commonjs require style, and
# another time for require.js and the browser.
lib: $(LIB_SRCS) $(CONFIG)
	@echo "  TS    $@"
	$(TSC) $(TSFLAGS) -d -m commonjs --outDir lib $(LIB_SRCS)
	touch $@

$(LIB): build.js build $(RUNTIME) $(REQUIRE) $(ALMOND)
	@echo "  R.JS  $@"
	$(REQUIRE) -o $< $(QUIET_RJS)

$(LIB_MIN): build_min.js build $(REQUIRE) $(ALMOND)
	@echo "  R.JS  $@"
	$(REQUIRE) -o $< $(QUIET_RJS)

$(RTEST_CMD): $(RTEST_DIR) .gitmodules
	@echo "  GIT   $<"
	git submodule update --init
	touch $@

$(TEST): lib node_modules $(TEST_SRCS)
	@echo "  TS    test"
	$(TSLINT) -c .tslint.json $(TEST_SRCS)
	$(TSC) $(TSFLAGS) -d -m commonjs --outDir test $(TEST_SRCS)
	touch $@

test check: $(TEST)
	@echo "  TEST"
	$(MOCHA)

rtest: lib $(RTEST_CMD)
	./$(RTEST_CMD) ./bin/mdl.js $(RTEST_DIR)

clean:
	rm -rf build build-rt lib
	rm -f sd.js sd.min.js
	find . -name '*~' | xargs rm -f

distclean: clean
	rm -rf node_modules bower_components

bump-tests: $(RTEST_CMD)
	cd $(RTEST_DIR) && git pull origin master
	git commit $(RTEST_DIR) -m 'test: bump test-models'

.PHONY: all clean distclean test rtest check bump-tests
