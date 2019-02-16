const regexp_has_sticky=RegExp.prototype.hasOwnProperty('sticky');
//
const template_names = {
  django: false,
  erb: false,
  handlebars: false,
  php: false
};
//
const TOKEN = {

  TAG_OPEN: 'TK_TAG_OPEN',
  TAG_CLOSE: 'TK_TAG_CLOSE',
  ATTRIBUTE: 'TK_ATTRIBUTE',
  EQUALS: 'TK_EQUALS',
  VALUE: 'TK_VALUE',
  COMMENT: 'TK_COMMENT',
  TEXT: 'TK_TEXT',
  UNKNOWN: 'TK_UNKNOWN',
  START: 'TK_START',
  RAW: 'TK_RAW',
  EOF: 'TK_EOF',
};
//
class Pattern{
	constructor(input_scanner,parent){
		const e=this;
		e._input=input_scanner;
		e._starting_pattern=null;
		e._match_pattern=null;
		e._until_pattern=null;
		e._until_after=false;
		if(parent){
			const f=e._input.get_regexp;
			e._starting_pattern=f(parent._starting_pattern, true);
			e._match_pattern=f(parent._match_pattern, true);
			e._until_pattern=f(parent._until_pattern);
			e._until_after=parent._until_after;
		}
	}

	read(){
		const e=this,f=e._input.read;
		let result=f(e._starting_pattern);
		if(!e._starting_pattern||result){
			result+=f(e._match_pattern,e._until_pattern,e._until_after);
		};
		return result
	}

	read_match(){
		const e=this;
		return e._input.match(e._match_pattern);
	}

	until_after(pattern){
		const e=this,x=e._create();
		x._until_after=true;
		x._until_pattern=e._input.get_regexp(pattern);
		x._update();
		return x
	}

	until(pattern){
		const e=this,x=e._create();
		x._until_after=false;
		x._until_pattern=e._input.get_regexp(pattern);
		x._update();
		return x
	}

	starting_with(pattern){
		const e=this,x=e._create();
		x._starting_pattern=e._input.get_regexp(pattern,true);
		x._update();
		return x
	}

	matching(pattern) {
		const e=this,x=e._create();
		x._match_pattern=e._input.get_regexp(pattern,true);
		x._update();
		return x;
	}

	_create(){
		const e=this;
		return new Pattern(e._input,e);
	}

	_update(){}
}
//
class WhitespacePattern extends Pattern{
	constructor(input_scanner,parent){
		super(input_scanner,parent);
		const e=this;
		if(parent){
			e._line_regexp=e._input.get_regexp(parent._line_regexp);
		} else {
			e.__set_whitespace_patterns('','');
		};
		e.newline_count=0;
		e.whitespace_before_token='';
	}


	__set_whitespace_patterns(whitespace_chars,newline_chars){
		whitespace_chars+='\\t ';
		newline_chars+='\\n\\r';
		const e=this,f=e._input.get_regexp;
		e._match_pattern=f(`[${whitespace_chars}${newline_chars}]+`,true);
		e._newline_regexp=f(`\\r\\n|[${newline_chars}]`);
	}


	read(){
		const e=this;
		e.newline_count=0;
		e.whitespace_before_token='';
		const s=e._input.read(e._match_pattern);
		if(s===' '){
			e.whitespace_before_token=' ';
		}else if (s){
			const m=e.__split(e._newline_regexp, s);
			e.newline_count=m.length-1;
			e.whitespace_before_token=m[e.newline_count];
		};
		return s
	}


	matching(whitespace_chars,newline_chars){
		const x=this._create();
		x.__set_whitespace_patterns(whitespace_chars,newline_chars);
		x._update();
		return x
	}


	_create(){
		const e=this;
		return new WhitespacePattern(e._input,e);
	}


	__split(regexp,s){//regexp,input_string
		regexp.lastIndex=0;
		let i=0;//start_index
		const result=[];
		let next_match=regexp.exec(s);
		while(next_match){
			result.push(s.substring(i,next_match.index));
			i=next_match.index+next_match[0].length;
			next_match=regexp.exec(s);
		};
		result.push(i<s.length?s.substring(i,s.length):'');
		return result;
	}
}
//
class TemplatablePattern extends Pattern {
	constructor(a,b){//input_scanner,parent
		super(a,b);
		const e=this;
		e.__template_pattern=null;
		e._disabled=Object.assign({},template_names);
		e._excluded=Object.assign({},template_names);

		if(b){
			e.__template_pattern=e._input.get_regexp(b.__template_pattern);
			e._excluded=Object.assign(e._excluded,b._excluded);
			e._disabled=Object.assign(e._disabled,b._disabled);
		};

		const pattern=new Pattern(a);
		e.__patterns={
			handlebars_comment: pattern.starting_with(/{{!--/).until_after(/--}}/),
			handlebars: pattern.starting_with(/{{/).until_after(/}}/),
			php: pattern.starting_with(/<\?(?:[=]|php)/).until_after(/\?>/),
			erb: pattern.starting_with(/<%[^%]/).until_after(/[^%]%>/),
			django: pattern.starting_with(/{%/).until_after(/%}/),
			django_value: pattern.starting_with(/{{/).until_after(/}}/),
			django_comment: pattern.starting_with(/{#/).until_after(/#}/)
		};
	}

	_create() {
		const e=this;
		return new TemplatablePattern(e._input,e);
	}

	_update() {
		this.__set_templated_pattern();
	}

	disable(language) {
		const result=this._create();
		result._disabled[language]=true;
		result._update();
		return result;
	}

	exclude(language) {
		const result=this._create();
		result._excluded[language]=true;
		result._update();
		return result;
	}

	read() {
		let result='';
		if (this._match_pattern) {
			result=this._input.read(this._starting_pattern);
		} else {
			result=this._input.read(this._starting_pattern, this.__template_pattern);
		}
		let next=this._read_template();
		while (next) {
			if (this._match_pattern) {
				next += this._input.read(this._match_pattern);
			} else {
				next += this._input.readUntil(this.__template_pattern);
			}
			result += next;
			next=this._read_template();
		}

		if (this._until_after) {
			result += this._input.readUntilAfter(this._until_pattern);
		}
		return result;
	}

	__set_templated_pattern() {
		const items=[];

		if (!this._disabled.php) {
			items.push(this.__patterns.php._starting_pattern.source);
		}
		if (!this._disabled.handlebars) {
			items.push(this.__patterns.handlebars._starting_pattern.source);
		}
		if (!this._disabled.erb) {
			items.push(this.__patterns.erb._starting_pattern.source);
		}
		if (!this._disabled.django) {
			items.push(this.__patterns.django._starting_pattern.source);
			items.push(this.__patterns.django_value._starting_pattern.source);
			items.push(this.__patterns.django_comment._starting_pattern.source);
		}

		if (this._until_pattern) {
			items.push(this._until_pattern.source);
		}
		this.__template_pattern=this._input.get_regexp(`(?:${items.join('|')})`);
	}

	_read_template(){
		let s='';
		const c=this._input.peek();
		if (c === '<') {
			const peek1=this._input.peek(1);

			if (!this._disabled.php && !this._excluded.php && peek1 === '?') {
				s=s ||
					this.__patterns.php.read();
			}
			if (!this._disabled.erb && !this._excluded.erb && peek1 === '%') {
				s=s ||
					this.__patterns.erb.read();
			}
		} else if (c === '{') {
			if (!this._disabled.handlebars && !this._excluded.handlebars) {
				s=s ||
					this.__patterns.handlebars_comment.read();
				s=s ||
					this.__patterns.handlebars.read();
			}
			if (!this._disabled.django) {
				// django coflicts with handlebars a bit.
				if (!this._excluded.django && !this._excluded.handlebars) {
					s=s ||
						this.__patterns.django_value.read();
				}
				if (!this._excluded.django) {
					s=s ||
						this.__patterns.django_comment.read();
					s=s ||
						this.__patterns.django.read();
				}
			}
		}
		return s;
	}
}

//
class InputScanner{
	constructor(s){//input_string
		const e=this;
		e.__input=s||'';
		e.__input_length=e.__input.length;
		e.__position=0;
	}

	restart(){this.__position=0}
	back(){const e=this;if(e.__position > 0){e.__position-=1}}
	hasNext(){const e=this;return e.__position<e.__input_length}

	next(){
		let s=null;
		const e=this;
		if(e.hasNext()){
			s=e.__input.charAt(e.__position);
			e.__position+=1
		};
		return s
	}


	peek(a){//index
		let s=null,i=a||0;
		const e=this;
		i+=e.__position;
		if(i>=0 && i<e.__input_length){s=e.__input.charAt(i)};
		return s
	}



	__match(a,b){//pattern,index
		a.lastIndex=b;
		let m=a.exec(this.__input);
		if(m && !(regexp_has_sticky && a.sticky) && m.index!==b){m=null}
		return m
	}

	test(a,b=0){//pattern,index
		const e=this;
		b+=e.__position;
		return (b>=0 && b<e.__input_length)?!!this.__match(a, b):false;
	}

	testChar(a,b){//pattern,index
		const s=this.peek(b);
		a.lastIndex=0;
		return s!== null && a.test(s);
	}

	match(a){//pattern
		const e=this;
		let m=e.__match(a,e.__position);
		if(m){
			e.__position+=m[0].length;
		}else{
			m=null
		};
		return m
	}

	read(a,b,c){//starting_pattern, until_pattern, until_after
		const e=this;
		let s='',m;
		if(a){if(m=e.match(a)){s+=m[0]}};
		if(b && (m||!a)){s+=e.readUntil(b,c)};
		return s
	}

	readUntil(p,until_after){//pattern,until_after
		const e=this;
		let s='',i=p.lastIndex=e.__position;//match_index
		const m=p.exec(e.__input);//pattern_match
		if(m){
			i=m.index;
			if(until_after){i+=m[0].length}
		}else{
			i=e.__input_length
		};
		s=e.__input.substring(e.__position,i);
		e.__position=i;
		return s
	}

	readUntilAfter(p){return this.readUntil(p,true)}

	get_regexp(p,v){//pattern,match_from
		let result=null,flags=(v && regexp_has_sticky)?'y':'g';
		if(typeof p ==='string' && p!==''){
			return new RegExp(p, flags);
		}else if(p){
			return new RegExp(p.source, flags);
		}else{
			return null
		};
	}


	get_literal_regexp(s){//literal_string
		return RegExp(s.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'))
	}


	peekUntilAfter(pattern) {
		const e=this,
		i=e.__position,//start
		v=e.readUntilAfter(pattern);
		e.__position=i;
		return v;
	}

	lookBack(v){//testVal
		const e=this,
		i=e.__position-1,//start
		l=v.length;
		return i>=l && e.__input.substring(i-l,i).toLowerCase()===v
	}
}
//
class TokenStream{
	constructor(a){
		const e=this;
		e.__parent_token=a;
		e.__tokens=[];
		e.__tokens_length =0;
		e.__position=0;
	}

	restart(){this.__position=0}

	isEmpty(){return this.__tokens_length===0}

	hasNext(){const e=this;return e.__position<e.__tokens_length}

	next(){
		const e=this;
		let s=null;
		if(e.hasNext()) {
			s=e.__tokens[e.__position];
			e.__position+=1
		};
		return s
	}

	peek(a){
		let s = null,i=a||0;
		const e=this;
		i+=e.__position;
		if(i>=0 && i< e.__tokens_length){s=e.__tokens[i]}
		return s
	}

	add(a){//token
		const e=this;
		if(e.__parent_token){a.parent=e.__parent_token};
		e.__tokens.push(a);
		e.__tokens_length+=1
	}
}
//
class Token{
	constructor(a,b,c,d){//type,text,newlines,whitespace_before
		const e=this;
		e.type=a;
		e.text=b;
		e.newlines=c||0;
		e.whitespace_before=d||'';
		e.comments_before=null;
		e.parent=null;
		e.next=null;
		e.previous=null;
		e.opened=null;
		e.closed=null;
		e.directives=null;
	}
}

//...
//
class Tokenizer{

	constructor(s,o){
		const e=this;
		e.__tokens=null;
		e._options=o||{};
		e._patterns={whitespace:new WhitespacePattern(e._input=new InputScanner(s))};
	}

	tokenize(){
		const e=this;
		e._input.restart();
		e.__tokens=new TokenStream();
		e._reset();

		let current,
		open_token=null,
		previous=new Token(TOKEN.START,''),
		comments=new TokenStream();
		const m=[];
		while(previous.type !== TOKEN.EOF){
			current=e._get_next_token(previous, open_token);
			while(e._is_comment(current)){
				comments.add(current);
				current=e._get_next_token(previous, open_token);
			};
			if(!comments.isEmpty()) {
				current.comments_before=comments;
				comments=new TokenStream();
			};
			current.parent=open_token;
			if (e._is_opening(current)) {
				m.push(open_token);
				open_token=current;
			} else if (open_token && e._is_closing(current, open_token)) {
				current.opened=open_token;
				open_token.closed=current;
				open_token=m.pop();
				current.parent=open_token;
			};
			current.previous=previous;
			previous.next=current;
			e.__tokens.add(current);
			previous=current;
		};
		return e.__tokens;
	}

	_is_first_token(){return this.__tokens.isEmpty()}

	_reset(){}

	_get_next_token(previous_token,open_token){//previous_token, open_token
		const e=this;
		e._readWhitespace();
		const s=e._input.read(/.+/g);
		if(s){
			return e._create_token(TOKEN.RAW,s)
		}else{
			return e._create_token(TOKEN.EOF, '')
		}
	}

	_is_comment(current_token) {return false}
	_is_opening(current_token) {return false}
	_is_closing(current_token, open_token){return false}

	_create_token(a,b){//type,text
		const x=this._patterns.whitespace;
		return new Token(a,b,x.newline_count,x.whitespace_before_token);
	}

	_readWhitespace(){return this._patterns.whitespace.read()}
}
//
class Tokenizerx extends Tokenizer {
	constructor(s, options){//input_string, options
		super(s,options);
		const e=this;
		e._current_tag_name='';
		const templatable_reader=new TemplatablePattern(e._input),
		pattern_reader=new Pattern(e._input);

		e.__patterns={
			word: templatable_reader.until(/[\n\r\t <]/),
			single_quote: templatable_reader.until_after(/'/),
			double_quote: templatable_reader.until_after(/"/),
			attribute: templatable_reader.until(/[\n\r\t =\/>]/),
			element_name: templatable_reader.until(/[\n\r\t >\/]/),

			handlebars_comment: pattern_reader.starting_with(/{{!--/).until_after(/--}}/),
			handlebars: pattern_reader.starting_with(/{{/).until_after(/}}/),
			handlebars_open: pattern_reader.until(/[\n\r\t }]/),
			handlebars_raw_close: pattern_reader.until(/}}/),
			comment: pattern_reader.starting_with(/<!--/).until_after(/-->/),
			cdata: pattern_reader.starting_with(/<!\[cdata\[/).until_after(/]]>/),
			// https://en.wikipedia.org/wiki/Conditional_comment
			conditional_comment: pattern_reader.starting_with(/<!\[/).until_after(/]>/),
			processing: pattern_reader.starting_with(/<\?/).until_after(/\?>/)
		};

		if (e._options.indent_handlebars) {
			e.__patterns.word=e.__patterns.word.exclude('handlebars');
		}

		e._unformatted_content_delimiter=null;

		if (e._options.unformatted_content_delimiter) {
			const literal_regexp=e._input.get_literal_regexp(e._options.unformatted_content_delimiter);
			e.__patterns.unformatted_content_delimiter =
				pattern_reader.matching(literal_regexp)
				.until_after(literal_regexp);
		}
	}

	_is_comment(current_token) {
		return (
			// jshint unused:false
			//current_token.type === TOKEN.COMMENT || current_token.type === TOKEN.UNKNOWN;
			false
		);
	}

	_is_opening({type}) {
		return type === TOKEN.TAG_OPEN;
	}

	_is_closing({type, text}, open_token) {
		return type === TOKEN.TAG_CLOSE &&
			(open_token && (
				((text === '>' || text === '/>') && open_token.text[0] === '<') ||
				(text === '}}' && open_token.text[0] === '{' && open_token.text[1] === '{')));
	}

	_reset() {
		this._current_tag_name='';
	}

	_get_next_token(previous_token, open_token) { // jshint unused:false
		let token=null;
		this._readWhitespace();
		const c=this._input.peek();

		if (c === null) {
			return this._create_token(TOKEN.EOF, '');
		}

		token=token || this._read_open_handlebars(c, open_token);
		token=token || this._read_attribute(c, previous_token, open_token);
		token=token || this._read_raw_content(previous_token, open_token);
		token=token || this._read_close(c, open_token);
		token=token || this._read_content_word(c);
		token=token || this._read_comment(c);
		token=token || this._read_open(c, open_token);
		token=token || this._create_token(TOKEN.UNKNOWN, this._input.next());

		return token;
	}

	_read_comment(c) { // jshint unused:false
		let token=null;
		let resulting_string=null;
		let directives=null;

		if (c === '<') {
			const peek1=this._input.peek(1);
			//if we're in a comment, do something special
			// We treat all comments as literals, even more than preformatted tags
			// we just look for the appropriate close tag
			if (c === '<' && (peek1 === '!' || peek1 === '?')) {
				resulting_string=this.__patterns.comment.read();

				// only process directive on html comments
				if (resulting_string) {
					directives=directives_core.get_directives(resulting_string);
					if (directives && directives.ignore === 'start') {
						resulting_string += directives_core.readIgnored(this._input);
					}
				} else {
					resulting_string=this.__patterns.cdata.read();
					resulting_string=resulting_string || this.__patterns.conditional_comment.read();
					resulting_string=resulting_string || this.__patterns.processing.read();
				}
			}

			if (resulting_string) {
				token=this._create_token(TOKEN.COMMENT, resulting_string);
				token.directives=directives;
			}
		}

		return token;
	}

	_read_open(c, open_token) {
		let resulting_string=null;
		let token=null;
		if (!open_token) {
			if (c === '<') {

				resulting_string=this._input.next();
				if (this._input.peek() === '/') {
					resulting_string += this._input.next();
				}
				resulting_string += this.__patterns.element_name.read();
				token=this._create_token(TOKEN.TAG_OPEN, resulting_string);
			}
		}
		return token;
	}

	_read_open_handlebars(c, open_token) {
		let resulting_string=null;
		let token=null;
		if (!open_token) {
			if (this._options.indent_handlebars && c === '{' && this._input.peek(1) === '{') {
				if (this._input.peek(2) === '!') {
					resulting_string=this.__patterns.handlebars_comment.read();
					resulting_string=resulting_string || this.__patterns.handlebars.read();
					token=this._create_token(TOKEN.COMMENT, resulting_string);
				} else {
					resulting_string=this.__patterns.handlebars_open.read();
					token=this._create_token(TOKEN.TAG_OPEN, resulting_string);
				}
			}
		}
		return token;
	}

	_read_close(c,b) {//c, open_token
		let resulting_string=null;
		let token=null;
		if (b) {
			if (b.text[0] === '<' && (c === '>' || (c === '/' && this._input.peek(1) === '>'))) {
				resulting_string=this._input.next();
				if (c === '/') { //	for close tag "/>"
					resulting_string += this._input.next();
				}
				token=this._create_token(TOKEN.TAG_CLOSE, resulting_string);
			} else if (b.text[0] === '{' && c === '}' && this._input.peek(1) === '}') {
				this._input.next();
				this._input.next();
				token=this._create_token(TOKEN.TAG_CLOSE, '}}');
			}
		}

		return token;
	}

	_read_attribute(c, {type}, b) {//c, {type},open_token
		let token=null,s='';
		if (b && b.text[0] === '<') {

			if (c === '=') {
				token=this._create_token(TOKEN.EQUALS, this._input.next());
			} else if (c === '"' || c === "'") {
				let content=this._input.next();
				if (c === '"') {
					content += this.__patterns.double_quote.read();
				} else {
					content += this.__patterns.single_quote.read();
				}
				token=this._create_token(TOKEN.VALUE, content);
			} else {
				s=this.__patterns.attribute.read();

				if (s) {
					if (type === TOKEN.EQUALS) {
						token=this._create_token(TOKEN.VALUE, s);
					} else {
						token=this._create_token(TOKEN.ATTRIBUTE, s);
					}
				}
			}
		}
		return token;
	}

	_is_content_unformatted(x){//tag_name
		const o=this._options;
		return !o.void_elements.includes(x) &&(x === 'script' || x === 'style' ||o.content_unformatted.includes(x) ||o.unformatted.includes(x))
	}

	_read_raw_content({type,opened},b){//{type,opened},open_token
		const e=this;
		let s='';
		if(b && b.text[0]==='{'){
			s=e.__patterns.handlebars_raw_close.read();
		}else if(type === TOKEN.TAG_CLOSE && (opened.text[0] === '<')) {
			const x=opened.text.substr(1).toLowerCase();
			if(e._is_content_unformatted(x)) {
				s=e._input.readUntil(new RegExp(`</${x}[\\n\\r\\t ]*?>`, 'ig'));
			}
		};
		return s?e._create_token(TOKEN.TEXT,s):null;
	}

	_read_content_word(c){
		const e=this,p=e.__patterns,m=e._options.unformatted_content_delimiter;
		let s='';
		if(m && m[0]===c) {
			s=p.unformatted_content_delimiter.read();
		};
		if(!s){
			s=p.word.read();
		};
		if(s){
			return e._create_token(TOKEN.TEXT,s);
		}
	}
}













function in_array(what, arr) {
  return arr.includes(what);
}

function ltrim(s) {
  return s.replace(/^\s+/g, '');
}

function generateMapFromStrings(list) {
  const result = {};
  for (let x = 0; x < list.length; x++) {
    // make the mapped names underscored instead of dash
    result[list[x].replace(/-/g, '_')] = list[x];
  }
  return result;
}

function reserved_word(token, word) {
  return token && token.type === TOKEN.RESERVED && token.text === word;
}

function reserved_array(token, words) {
  return token && token.type === TOKEN.RESERVED && in_array(token.text, words);
}
// Unsure of what they mean, but they work. Worth cleaning up in future.
const special_words = ['case', 'return', 'do', 'if', 'throw', 'else', 'await', 'break', 'continue', 'async'];

const validPositionValues = ['before-newline', 'after-newline', 'preserve-newline'];

// Generate map from array
const OPERATOR_POSITION = generateMapFromStrings(validPositionValues);

const OPERATOR_POSITION_BEFORE_OR_PRESERVE = [OPERATOR_POSITION.before_newline, OPERATOR_POSITION.preserve_newline];

const MODE = {
  BlockStatement: 'BlockStatement', // 'BLOCK'
  Statement: 'Statement', // 'STATEMENT'
  ObjectLiteral: 'ObjectLiteral', // 'OBJECT',
  ArrayLiteral: 'ArrayLiteral', //'[EXPRESSION]',
  ForInitializer: 'ForInitializer', //'(FOR-EXPRESSION)',
  Conditional: 'Conditional', //'(COND-EXPRESSION)',
  Expression: 'Expression' //'(EXPRESSION)'
};

function remove_redundant_indentation(output, {multiline_frame, mode, start_line_index}) {
  // This implementation is effective but has some issues:
  //     - can cause line wrap to happen too soon due to indent removal
  //           after wrap points are calculated
  // These issues are minor compared to ugly indentation.

  if (multiline_frame ||
    mode === MODE.ForInitializer ||
    mode === MODE.Conditional) {
    return;
  }

  // remove one indent from each line inside this section
  output.remove_indent(start_line_index);
}

// we could use just string.split, but
// IE doesn't like returning empty strings
function split_linebreaks(s) {
  //return s.split(/\x0d\x0a|\x0a/);

  s = s.replace(acorn.allLineBreaks, '\n');
  const out = [];
  let idx = s.indexOf("\n");
  while (idx !== -1) {
    out.push(s.substring(0, idx));
    s = s.substring(idx + 1);
    idx = s.indexOf("\n");
  }
  if (s.length) {
    out.push(s);
  }
  return out;
}

function is_array(mode) {
  return mode === MODE.ArrayLiteral;
}

function is_expression(mode) {
  return in_array(mode, [MODE.Expression, MODE.ForInitializer, MODE.Conditional]);
}

function all_lines_start_with(lines, c) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.charAt(0) !== c) {
      return false;
    }
  }
  return true;
}

function each_line_matches_indent(lines, indent) {
  let i = 0;
  const len = lines.length;
  let line;
  for (; i < len; i++) {
    line = lines[i];
    // allow empty lines to pass through
    if (line && line.indexOf(indent) !== 0) {
      return false;
    }
  }
  return true;
}


class Beautifier {
  constructor(source_text, options = {}) {
    this._source_text = source_text || '';

    this._output = null;
    this._tokens = null;
    this._last_last_text = null;
    this._flags = null;
    this._previous_flags = null;

    this._flag_store = null;
    this._options = new Options(options);
  }

  create_flags(flags_base, mode) {
    let next_indent_level = 0;
    if (flags_base) {
      next_indent_level = flags_base.indentation_level;
      if (!this._output.just_added_newline() &&
        flags_base.line_indent_level > next_indent_level) {
        next_indent_level = flags_base.line_indent_level;
      }
    }

    const next_flags = {
      mode,
      parent: flags_base,
      last_token: flags_base ? flags_base.last_token : new Token(TOKEN.START_BLOCK, ''), // last token text
      last_word: flags_base ? flags_base.last_word : '', // last TOKEN.WORD passed
      declaration_statement: false,
      declaration_assignment: false,
      multiline_frame: false,
      inline_frame: false,
      if_block: false,
      else_block: false,
      do_block: false,
      do_while: false,
      import_block: false,
      in_case_statement: false, // switch(..){ INSIDE HERE }
      in_case: false, // we're on the exact line with "case 0:"
      case_body: false, // the indented case-action block
      indentation_level: next_indent_level,
      alignment: 0,
      line_indent_level: flags_base ? flags_base.line_indent_level : next_indent_level,
      start_line_index: this._output.get_line_number(),
      ternary_depth: 0
    };
    return next_flags;
  }

  _reset(source_text) {
    const baseIndentString = source_text.match(/^[\t ]*/)[0];

    this._last_last_text = ''; // pre-last token text
    this._output = new Output(this._options, baseIndentString);

    // If testing the ignore directive, start with output disable set to true
    this._output.raw = this._options.test_output_raw;


    // Stack of parsing/formatting states, including MODE.
    // We tokenize, parse, and output in an almost purely a forward-only stream of token input
    // and formatted output.  This makes the beautifier less accurate than full parsers
    // but also far more tolerant of syntax errors.
    //
    // For example, the default mode is MODE.BlockStatement. If we see a '{' we push a new frame of type
    // MODE.BlockStatement on the the stack, even though it could be object literal.  If we later
    // encounter a ":", we'll switch to to MODE.ObjectLiteral.  If we then see a ";",
    // most full parsers would die, but the beautifier gracefully falls back to
    // MODE.BlockStatement and continues on.
    this._flag_store = [];
    this.set_mode(MODE.BlockStatement);
    const tokenizer = new Tokenizer(source_text, this._options);
    this._tokens = tokenizer.tokenize();
    return source_text;
  }

  beautify() {
    // if disabled, return the input unchanged.
    if (this._options.disabled) {
      return this._source_text;
    }
/*
    let sweet_code;
    const source_text = this._reset(this._source_text);

    let eol = this._options.eol;
    if (this._options.eol === 'auto') {
      eol = '\n';
      if (source_text && acorn.lineBreak.test(source_text || '')) {
        eol = source_text.match(acorn.lineBreak)[0];
      }
    }
*/
    let current_token = this._tokens.next();
    while (current_token) {
      this.handle_token(current_token);

      this._last_last_text = this._flags.last_token.text;
      this._flags.last_token = current_token;

      current_token = this._tokens.next();
    }

    sweet_code = this._output.get_code(eol);

    return sweet_code;
  }

  handle_token(current_token, preserve_statement_flags) {
    if (current_token.type === TOKEN.START_EXPR) {
      this.handle_start_expr(current_token);
    } else if (current_token.type === TOKEN.END_EXPR) {
      this.handle_end_expr(current_token);
    } else if (current_token.type === TOKEN.START_BLOCK) {
      this.handle_start_block(current_token);
    } else if (current_token.type === TOKEN.END_BLOCK) {
      this.handle_end_block(current_token);
    } else if (current_token.type === TOKEN.WORD) {
      this.handle_word(current_token);
    } else if (current_token.type === TOKEN.RESERVED) {
      this.handle_word(current_token);
    } else if (current_token.type === TOKEN.SEMICOLON) {
      this.handle_semicolon(current_token);
    } else if (current_token.type === TOKEN.STRING) {
      this.handle_string(current_token);
    } else if (current_token.type === TOKEN.EQUALS) {
      this.handle_equals(current_token);
    } else if (current_token.type === TOKEN.OPERATOR) {
      this.handle_operator(current_token);
    } else if (current_token.type === TOKEN.COMMA) {
      this.handle_comma(current_token);
    } else if (current_token.type === TOKEN.BLOCK_COMMENT) {
      this.handle_block_comment(current_token, preserve_statement_flags);
    } else if (current_token.type === TOKEN.COMMENT) {
      this.handle_comment(current_token, preserve_statement_flags);
    } else if (current_token.type === TOKEN.DOT) {
      this.handle_dot(current_token);
    } else if (current_token.type === TOKEN.EOF) {
      this.handle_eof(current_token);
    } else if (current_token.type === TOKEN.UNKNOWN) {
      this.handle_unknown(current_token, preserve_statement_flags);
    } else {
      this.handle_unknown(current_token, preserve_statement_flags);
    }
  }

  handle_whitespace_and_comments(current_token, preserve_statement_flags) {
    let newlines = current_token.newlines;
    const keep_whitespace = this._options.keep_array_indentation && is_array(this._flags.mode);

    if (current_token.comments_before) {
      let comment_token = current_token.comments_before.next();
      while (comment_token) {
        // The cleanest handling of inline comments is to treat them as though they aren't there.
        // Just continue formatting and the behavior should be logical.
        // Also ignore unknown tokens.  Again, this should result in better behavior.
        this.handle_whitespace_and_comments(comment_token, preserve_statement_flags);
        this.handle_token(comment_token, preserve_statement_flags);
        comment_token = current_token.comments_before.next();
      }
    }

    if (keep_whitespace) {
      for (let i = 0; i < newlines; i += 1) {
        this.print_newline(i > 0, preserve_statement_flags);
      }
    } else {
      if (this._options.max_preserve_newlines && newlines > this._options.max_preserve_newlines) {
        newlines = this._options.max_preserve_newlines;
      }

      if (this._options.preserve_newlines) {
        if (newlines > 1) {
          this.print_newline(false, preserve_statement_flags);
          for (let j = 1; j < newlines; j += 1) {
            this.print_newline(true, preserve_statement_flags);
          }
        }
      }
    }

  }

  allow_wrap_or_preserved_newline({newlines, text}, force_linewrap = false) {
    // Never wrap the first token on a line
    if (this._output.just_added_newline()) {
      return;
    }

    let shouldPreserveOrForce = (this._options.preserve_newlines && newlines) || force_linewrap;
    const operatorLogicApplies = in_array(this._flags.last_token.text, positionable_operators) ||
      in_array(text, positionable_operators);

    if (operatorLogicApplies) {
      const shouldPrintOperatorNewline = (
          in_array(this._flags.last_token.text, positionable_operators) &&
          in_array(this._options.operator_position, OPERATOR_POSITION_BEFORE_OR_PRESERVE)
        ) ||
        in_array(text, positionable_operators);
      shouldPreserveOrForce = shouldPreserveOrForce && shouldPrintOperatorNewline;
    }

    if (shouldPreserveOrForce) {
      this.print_newline(false, true);
    } else if (this._options.wrap_line_length) {
      if (reserved_array(this._flags.last_token, newline_restricted_tokens)) {
        // These tokens should never have a newline inserted
        // between them and the following expression.
        return;
      }
      this._output.set_wrap_point();
    }
  }

  print_newline(force_newline, preserve_statement_flags) {
    if (!preserve_statement_flags) {
      if (this._flags.last_token.text !== ';' && this._flags.last_token.text !== ',' && this._flags.last_token.text !== '=' && (this._flags.last_token.type !== TOKEN.OPERATOR || this._flags.last_token.text === '--' || this._flags.last_token.text === '++')) {
        const next_token = this._tokens.peek();
        while (this._flags.mode === MODE.Statement &&
          !(this._flags.if_block && reserved_word(next_token, 'else')) &&
          !this._flags.do_block) {
          this.restore_mode();
        }
      }
    }

    if (this._output.add_new_line(force_newline)) {
      this._flags.multiline_frame = true;
    }
  }

  print_token_line_indentation({newlines, text, whitespace_before}) {
    if (this._output.just_added_newline()) {
      if (this._options.keep_array_indentation &&
        newlines &&
        (text === '[' || is_array(this._flags.mode))) {
        this._output.current_line.set_indent(-1);
        this._output.current_line.push(whitespace_before);
        this._output.space_before_token = false;
      } else if (this._output.set_indent(this._flags.indentation_level, this._flags.alignment)) {
        this._flags.line_indent_level = this._flags.indentation_level;
      }
    }
  }

  print_token(current_token, printable_token) {
    if (this._output.raw) {
      this._output.add_raw_token(current_token);
      return;
    }

    if (this._options.comma_first && current_token.previous && current_token.previous.type === TOKEN.COMMA &&
      this._output.just_added_newline()) {
      if (this._output.previous_line.last() === ',') {
        const popped = this._output.previous_line.pop();
        // if the comma was already at the start of the line,
        // pull back onto that line and reprint the indentation
        if (this._output.previous_line.is_empty()) {
          this._output.previous_line.push(popped);
          this._output.trim(true);
          this._output.current_line.pop();
          this._output.trim();
        }

        // add the comma in front of the next token
        this.print_token_line_indentation(current_token);
        this._output.add_token(',');
        this._output.space_before_token = true;
      }
    }

    printable_token = printable_token || current_token.text;
    this.print_token_line_indentation(current_token);
    this._output.non_breaking_space = true;
    this._output.add_token(printable_token);
    if (this._output.previous_token_wrapped) {
      this._flags.multiline_frame = true;
    }
  }

  indent() {
    this._flags.indentation_level += 1;
    this._output.set_indent(this._flags.indentation_level, this._flags.alignment);
  }

  deindent() {
    if (this._flags.indentation_level > 0 &&
      ((!this._flags.parent) || this._flags.indentation_level > this._flags.parent.indentation_level)) {
      this._flags.indentation_level -= 1;
      this._output.set_indent(this._flags.indentation_level, this._flags.alignment);
    }
  }

  set_mode(mode) {
    if (this._flags) {
      this._flag_store.push(this._flags);
      this._previous_flags = this._flags;
    } else {
      this._previous_flags = this.create_flags(null, mode);
    }

    this._flags = this.create_flags(this._previous_flags, mode);
    this._output.set_indent(this._flags.indentation_level, this._flags.alignment);
  }

  restore_mode() {
    if (this._flag_store.length > 0) {
      this._previous_flags = this._flags;
      this._flags = this._flag_store.pop();
      if (this._previous_flags.mode === MODE.Statement) {
        remove_redundant_indentation(this._output, this._previous_flags);
      }
      this._output.set_indent(this._flags.indentation_level, this._flags.alignment);
    }
  }

  start_of_object_property() {
    return this._flags.parent.mode === MODE.ObjectLiteral && this._flags.mode === MODE.Statement && (
      (this._flags.last_token.text === ':' && this._flags.ternary_depth === 0) || (reserved_array(this._flags.last_token, ['get', 'set'])));
  }

  start_of_statement(current_token) {
    let start = false;
    start = start || reserved_array(this._flags.last_token, ['var', 'let', 'const']) && current_token.type === TOKEN.WORD;
    start = start || reserved_word(this._flags.last_token, 'do');
    start = start || (!(this._flags.parent.mode === MODE.ObjectLiteral && this._flags.mode === MODE.Statement)) && reserved_array(this._flags.last_token, newline_restricted_tokens) && !current_token.newlines;
    start = start || reserved_word(this._flags.last_token, 'else') &&
      !(reserved_word(current_token, 'if') && !current_token.comments_before);
    start = start || (this._flags.last_token.type === TOKEN.END_EXPR && (this._previous_flags.mode === MODE.ForInitializer || this._previous_flags.mode === MODE.Conditional));
    start = start || (this._flags.last_token.type === TOKEN.WORD && this._flags.mode === MODE.BlockStatement &&
      !this._flags.in_case &&
      !(current_token.text === '--' || current_token.text === '++') &&
      this._last_last_text !== 'function' &&
      current_token.type !== TOKEN.WORD && current_token.type !== TOKEN.RESERVED);
    start = start || (this._flags.mode === MODE.ObjectLiteral && (
      (this._flags.last_token.text === ':' && this._flags.ternary_depth === 0) || reserved_array(this._flags.last_token, ['get', 'set'])));

    if (start) {
      this.set_mode(MODE.Statement);
      this.indent();

      this.handle_whitespace_and_comments(current_token, true);

      // Issue #276:
      // If starting a new statement with [if, for, while, do], push to a new line.
      // if (a) if (b) if(c) d(); else e(); else f();
      if (!this.start_of_object_property()) {
        this.allow_wrap_or_preserved_newline(current_token,
          reserved_array(current_token, ['do', 'for', 'if', 'while']));
      }
      return true;
    }
    return false;
  }

  handle_start_expr(current_token) {
    // The conditional starts the statement if appropriate.
    if (!this.start_of_statement(current_token)) {
      this.handle_whitespace_and_comments(current_token);
    }

    let next_mode = MODE.Expression;
    if (current_token.text === '[') {

      if (this._flags.last_token.type === TOKEN.WORD || this._flags.last_token.text === ')') {
        // this is array index specifier, break immediately
        // a[x], fn()[x]
        if (reserved_array(this._flags.last_token, line_starters)) {
          this._output.space_before_token = true;
        }
        this.print_token(current_token);
        this.set_mode(next_mode);
        this.indent();
        if (this._options.space_in_paren) {
          this._output.space_before_token = true;
        }
        return;
      }

      next_mode = MODE.ArrayLiteral;
      if (is_array(this._flags.mode)) {
        if (this._flags.last_token.text === '[' ||
          (this._flags.last_token.text === ',' && (this._last_last_text === ']' || this._last_last_text === '}'))) {
          // ], [ goes to new line
          // }, [ goes to new line
          if (!this._options.keep_array_indentation) {
            this.print_newline();
          }
        }
      }

      if (!in_array(this._flags.last_token.type, [TOKEN.START_EXPR, TOKEN.END_EXPR, TOKEN.WORD, TOKEN.OPERATOR])) {
        this._output.space_before_token = true;
      }
    } else {
      if (this._flags.last_token.type === TOKEN.RESERVED) {
        if (this._flags.last_token.text === 'for') {
          this._output.space_before_token = this._options.space_before_conditional;
          next_mode = MODE.ForInitializer;
        } else if (in_array(this._flags.last_token.text, ['if', 'while'])) {
          this._output.space_before_token = this._options.space_before_conditional;
          next_mode = MODE.Conditional;
        } else if (in_array(this._flags.last_word, ['await', 'async'])) {
          // Should be a space between await and an IIFE, or async and an arrow function
          this._output.space_before_token = true;
        } else if (this._flags.last_token.text === 'import' && current_token.whitespace_before === '') {
          this._output.space_before_token = false;
        } else if (in_array(this._flags.last_token.text, line_starters) || this._flags.last_token.text === 'catch') {
          this._output.space_before_token = true;
        }
      } else if (this._flags.last_token.type === TOKEN.EQUALS || this._flags.last_token.type === TOKEN.OPERATOR) {
        // Support of this kind of newline preservation.
        // a = (b &&
        //     (c || d));
        if (!this.start_of_object_property()) {
          this.allow_wrap_or_preserved_newline(current_token);
        }
      } else if (this._flags.last_token.type === TOKEN.WORD) {
        this._output.space_before_token = false;

        // function name() vs function name ()
        // function* name() vs function* name ()
        // async name() vs async name ()
        // In ES6, you can also define the method properties of an object
        // var obj = {a: function() {}}
        // It can be abbreviated
        // var obj = {a() {}}
        // var obj = { a() {}} vs var obj = { a () {}}
        // var obj = { * a() {}} vs var obj = { * a () {}}
        const peek_back_two = this._tokens.peek(-3);
        if (this._options.space_after_named_function && peek_back_two) {
          // peek starts at next character so -1 is current token
          const peek_back_three = this._tokens.peek(-4);
          if (reserved_array(peek_back_two, ['async', 'function']) ||
            (peek_back_two.text === '*' && reserved_array(peek_back_three, ['async', 'function']))) {
            this._output.space_before_token = true;
          } else if (this._flags.mode === MODE.ObjectLiteral) {
            if ((peek_back_two.text === '{' || peek_back_two.text === ',') ||
              (peek_back_two.text === '*' && (peek_back_three.text === '{' || peek_back_three.text === ','))) {
              this._output.space_before_token = true;
            }
          }
        }
      } else {
        // Support preserving wrapped arrow function expressions
        // a.b('c',
        //     () => d.e
        // )
        this.allow_wrap_or_preserved_newline(current_token);
      }

      // function() vs function ()
      // yield*() vs yield* ()
      // function*() vs function* ()
      if ((this._flags.last_token.type === TOKEN.RESERVED && (this._flags.last_word === 'function' || this._flags.last_word === 'typeof')) ||
        (this._flags.last_token.text === '*' &&
          (in_array(this._last_last_text, ['function', 'yield']) ||
            (this._flags.mode === MODE.ObjectLiteral && in_array(this._last_last_text, ['{', ',']))))) {
        this._output.space_before_token = this._options.space_after_anon_function;
      }
    }

    if (this._flags.last_token.text === ';' || this._flags.last_token.type === TOKEN.START_BLOCK) {
      this.print_newline();
    } else if (this._flags.last_token.type === TOKEN.END_EXPR || this._flags.last_token.type === TOKEN.START_EXPR || this._flags.last_token.type === TOKEN.END_BLOCK || this._flags.last_token.text === '.' || this._flags.last_token.type === TOKEN.COMMA) {
      // do nothing on (( and )( and ][ and ]( and .(
      // TODO: Consider whether forcing this is required.  Review failing tests when removed.
      this.allow_wrap_or_preserved_newline(current_token, current_token.newlines);
    }

    this.print_token(current_token);
    this.set_mode(next_mode);
    if (this._options.space_in_paren) {
      this._output.space_before_token = true;
    }

    // In all cases, if we newline while inside an expression it should be indented.
    this.indent();
  }

  handle_end_expr(current_token) {
    // statements inside expressions are not valid syntax, but...
    // statements must all be closed when their container closes
    while (this._flags.mode === MODE.Statement) {
      this.restore_mode();
    }

    this.handle_whitespace_and_comments(current_token);

    if (this._flags.multiline_frame) {
      this.allow_wrap_or_preserved_newline(current_token,
        current_token.text === ']' && is_array(this._flags.mode) && !this._options.keep_array_indentation);
    }

    if (this._options.space_in_paren) {
      if (this._flags.last_token.type === TOKEN.START_EXPR && !this._options.space_in_empty_paren) {
        // () [] no inner space in empty parens like these, ever, ref #320
        this._output.trim();
        this._output.space_before_token = false;
      } else {
        this._output.space_before_token = true;
      }
    }
    this.deindent();
    this.print_token(current_token);
    this.restore_mode();

    remove_redundant_indentation(this._output, this._previous_flags);

    // do {} while () // no statement required after
    if (this._flags.do_while && this._previous_flags.mode === MODE.Conditional) {
      this._previous_flags.mode = MODE.Expression;
      this._flags.do_block = false;
      this._flags.do_while = false;

    }
  }

  handle_start_block(current_token) {
    this.handle_whitespace_and_comments(current_token);

    // Check if this is should be treated as a ObjectLiteral
    const next_token = this._tokens.peek();
    const second_token = this._tokens.peek(1);
    if (this._flags.last_word === 'switch' && this._flags.last_token.type === TOKEN.END_EXPR) {
      this.set_mode(MODE.BlockStatement);
      this._flags.in_case_statement = true;
    } else if (second_token && (
        (in_array(second_token.text, [':', ',']) && in_array(next_token.type, [TOKEN.STRING, TOKEN.WORD, TOKEN.RESERVED])) ||
        (in_array(next_token.text, ['get', 'set', '...']) && in_array(second_token.type, [TOKEN.WORD, TOKEN.RESERVED]))
      )) {
      // We don't support TypeScript,but we didn't break it for a very long time.
      // We'll try to keep not breaking it.
      if (!in_array(this._last_last_text, ['class', 'interface'])) {
        this.set_mode(MODE.ObjectLiteral);
      } else {
        this.set_mode(MODE.BlockStatement);
      }
    } else if (this._flags.last_token.type === TOKEN.OPERATOR && this._flags.last_token.text === '=>') {
      // arrow function: (param1, paramN) => { statements }
      this.set_mode(MODE.BlockStatement);
    } else if (in_array(this._flags.last_token.type, [TOKEN.EQUALS, TOKEN.START_EXPR, TOKEN.COMMA, TOKEN.OPERATOR]) ||
      reserved_array(this._flags.last_token, ['return', 'throw', 'import', 'default'])
    ) {
      // Detecting shorthand function syntax is difficult by scanning forward,
      //     so check the surrounding context.
      // If the block is being returned, imported, export default, passed as arg,
      //     assigned with = or assigned in a nested object, treat as an ObjectLiteral.
      this.set_mode(MODE.ObjectLiteral);
    } else {
      this.set_mode(MODE.BlockStatement);
    }

    const empty_braces = !next_token.comments_before && next_token.text === '}';
    const empty_anonymous_function = empty_braces && this._flags.last_word === 'function' &&
      this._flags.last_token.type === TOKEN.END_EXPR;

    if (this._options.brace_preserve_inline) // check for inline, set inline_frame if so
    {
      // search forward for a newline wanted inside this block
      let index = 0;
      let check_token = null;
      this._flags.inline_frame = true;
      do {
        index += 1;
        check_token = this._tokens.peek(index - 1);
        if (check_token.newlines) {
          this._flags.inline_frame = false;
          break;
        }
      } while (check_token.type !== TOKEN.EOF &&
        !(check_token.type === TOKEN.END_BLOCK && check_token.opened === current_token));
    }

    if ((this._options.brace_style === "expand" ||
        (this._options.brace_style === "none" && current_token.newlines)) &&
      !this._flags.inline_frame) {
      if (this._flags.last_token.type !== TOKEN.OPERATOR &&
        (empty_anonymous_function ||
          this._flags.last_token.type === TOKEN.EQUALS ||
          (reserved_array(this._flags.last_token, special_words) && this._flags.last_token.text !== 'else'))) {
        this._output.space_before_token = true;
      } else {
        this.print_newline(false, true);
      }
    } else { // collapse || inline_frame
      if (is_array(this._previous_flags.mode) && (this._flags.last_token.type === TOKEN.START_EXPR || this._flags.last_token.type === TOKEN.COMMA)) {
        if (this._flags.last_token.type === TOKEN.COMMA || this._options.space_in_paren) {
          this._output.space_before_token = true;
        }

        if (this._flags.last_token.type === TOKEN.COMMA || (this._flags.last_token.type === TOKEN.START_EXPR && this._flags.inline_frame)) {
          this.allow_wrap_or_preserved_newline(current_token);
          this._previous_flags.multiline_frame = this._previous_flags.multiline_frame || this._flags.multiline_frame;
          this._flags.multiline_frame = false;
        }
      }
      if (this._flags.last_token.type !== TOKEN.OPERATOR && this._flags.last_token.type !== TOKEN.START_EXPR) {
        if (this._flags.last_token.type === TOKEN.START_BLOCK && !this._flags.inline_frame) {
          this.print_newline();
        } else {
          this._output.space_before_token = true;
        }
      }
    }
    this.print_token(current_token);
    this.indent();

    // Except for specific cases, open braces are followed by a new line.
    if (!empty_braces && !(this._options.brace_preserve_inline && this._flags.inline_frame)) {
      this.print_newline();
    }
  }

  handle_end_block(current_token) {
    // statements must all be closed when their container closes
    this.handle_whitespace_and_comments(current_token);

    while (this._flags.mode === MODE.Statement) {
      this.restore_mode();
    }

    const empty_braces = this._flags.last_token.type === TOKEN.START_BLOCK;

    if (this._flags.inline_frame && !empty_braces) { // try inline_frame (only set if this._options.braces-preserve-inline) first
      this._output.space_before_token = true;
    } else if (this._options.brace_style === "expand") {
      if (!empty_braces) {
        this.print_newline();
      }
    } else {
      // skip {}
      if (!empty_braces) {
        if (is_array(this._flags.mode) && this._options.keep_array_indentation) {
          // we REALLY need a newline here, but newliner would skip that
          this._options.keep_array_indentation = false;
          this.print_newline();
          this._options.keep_array_indentation = true;

        } else {
          this.print_newline();
        }
      }
    }
    this.restore_mode();
    this.print_token(current_token);
  }

  handle_word(current_token) {
    if (current_token.type === TOKEN.RESERVED) {
      if (in_array(current_token.text, ['set', 'get']) && this._flags.mode !== MODE.ObjectLiteral) {
        current_token.type = TOKEN.WORD;
      } else if (current_token.text === 'import' && this._tokens.peek().text === '(') {
        current_token.type = TOKEN.WORD;
      } else if (in_array(current_token.text, ['as', 'from']) && !this._flags.import_block) {
        current_token.type = TOKEN.WORD;
      } else if (this._flags.mode === MODE.ObjectLiteral) {
        const next_token = this._tokens.peek();
        if (next_token.text === ':') {
          current_token.type = TOKEN.WORD;
        }
      }
    }

    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
      if (reserved_array(this._flags.last_token, ['var', 'let', 'const']) && current_token.type === TOKEN.WORD) {
        this._flags.declaration_statement = true;
      }
    } else if (current_token.newlines && !is_expression(this._flags.mode) &&
      (this._flags.last_token.type !== TOKEN.OPERATOR || (this._flags.last_token.text === '--' || this._flags.last_token.text === '++')) &&
      this._flags.last_token.type !== TOKEN.EQUALS &&
      (this._options.preserve_newlines || !reserved_array(this._flags.last_token, ['var', 'let', 'const', 'set', 'get']))) {
      this.handle_whitespace_and_comments(current_token);
      this.print_newline();
    } else {
      this.handle_whitespace_and_comments(current_token);
    }

    if (this._flags.do_block && !this._flags.do_while) {
      if (reserved_word(current_token, 'while')) {
        // do {} ## while ()
        this._output.space_before_token = true;
        this.print_token(current_token);
        this._output.space_before_token = true;
        this._flags.do_while = true;
        return;
      } else {
        // do {} should always have while as the next word.
        // if we don't see the expected while, recover
        this.print_newline();
        this._flags.do_block = false;
      }
    }

    // if may be followed by else, or not
    // Bare/inline ifs are tricky
    // Need to unwind the modes correctly: if (a) if (b) c(); else d(); else e();
    if (this._flags.if_block) {
      if (!this._flags.else_block && reserved_word(current_token, 'else')) {
        this._flags.else_block = true;
      } else {
        while (this._flags.mode === MODE.Statement) {
          this.restore_mode();
        }
        this._flags.if_block = false;
        this._flags.else_block = false;
      }
    }

    if (this._flags.in_case_statement && reserved_array(current_token, ['case', 'default'])) {
      this.print_newline();
      if (this._flags.case_body || this._options.jslint_happy) {
        // switch cases following one another
        this.deindent();
        this._flags.case_body = false;
      }
      this.print_token(current_token);
      this._flags.in_case = true;
      return;
    }

    if (this._flags.last_token.type === TOKEN.COMMA || this._flags.last_token.type === TOKEN.START_EXPR || this._flags.last_token.type === TOKEN.EQUALS || this._flags.last_token.type === TOKEN.OPERATOR) {
      if (!this.start_of_object_property()) {
        this.allow_wrap_or_preserved_newline(current_token);
      }
    }

    if (reserved_word(current_token, 'function')) {
      if (in_array(this._flags.last_token.text, ['}', ';']) ||
        (this._output.just_added_newline() && !(in_array(this._flags.last_token.text, ['(', '[', '{', ':', '=', ',']) || this._flags.last_token.type === TOKEN.OPERATOR))) {
        // make sure there is a nice clean space of at least one blank line
        // before a new function definition
        if (!this._output.just_added_blankline() && !current_token.comments_before) {
          this.print_newline();
          this.print_newline(true);
        }
      }
      if (this._flags.last_token.type === TOKEN.RESERVED || this._flags.last_token.type === TOKEN.WORD) {
        if (reserved_array(this._flags.last_token, ['get', 'set', 'new', 'export']) ||
          reserved_array(this._flags.last_token, newline_restricted_tokens)) {
          this._output.space_before_token = true;
        } else if (reserved_word(this._flags.last_token, 'default') && this._last_last_text === 'export') {
          this._output.space_before_token = true;
        } else if (this._flags.last_token.text === 'declare') {
          // accomodates Typescript declare function formatting
          this._output.space_before_token = true;
        } else {
          this.print_newline();
        }
      } else if (this._flags.last_token.type === TOKEN.OPERATOR || this._flags.last_token.text === '=') {
        // foo = function
        this._output.space_before_token = true;
      } else if (!this._flags.multiline_frame && (is_expression(this._flags.mode) || is_array(this._flags.mode))) {
        // (function
      } else {
        this.print_newline();
      }

      this.print_token(current_token);
      this._flags.last_word = current_token.text;
      return;
    }

    let prefix = 'NONE';

    if (this._flags.last_token.type === TOKEN.END_BLOCK) {

      if (this._previous_flags.inline_frame) {
        prefix = 'SPACE';
      } else if (!reserved_array(current_token, ['else', 'catch', 'finally', 'from'])) {
        prefix = 'NEWLINE';
      } else {
        if (this._options.brace_style === "expand" ||
          this._options.brace_style === "end-expand" ||
          (this._options.brace_style === "none" && current_token.newlines)) {
          prefix = 'NEWLINE';
        } else {
          prefix = 'SPACE';
          this._output.space_before_token = true;
        }
      }
    } else if (this._flags.last_token.type === TOKEN.SEMICOLON && this._flags.mode === MODE.BlockStatement) {
      // TODO: Should this be for STATEMENT as well?
      prefix = 'NEWLINE';
    } else if (this._flags.last_token.type === TOKEN.SEMICOLON && is_expression(this._flags.mode)) {
      prefix = 'SPACE';
    } else if (this._flags.last_token.type === TOKEN.STRING) {
      prefix = 'NEWLINE';
    } else if (this._flags.last_token.type === TOKEN.RESERVED || this._flags.last_token.type === TOKEN.WORD ||
      (this._flags.last_token.text === '*' &&
        (in_array(this._last_last_text, ['function', 'yield']) ||
          (this._flags.mode === MODE.ObjectLiteral && in_array(this._last_last_text, ['{', ',']))))) {
      prefix = 'SPACE';
    } else if (this._flags.last_token.type === TOKEN.START_BLOCK) {
      if (this._flags.inline_frame) {
        prefix = 'SPACE';
      } else {
        prefix = 'NEWLINE';
      }
    } else if (this._flags.last_token.type === TOKEN.END_EXPR) {
      this._output.space_before_token = true;
      prefix = 'NEWLINE';
    }

    if (reserved_array(current_token, line_starters) && this._flags.last_token.text !== ')') {
      if (this._flags.inline_frame || this._flags.last_token.text === 'else' || this._flags.last_token.text === 'export') {
        prefix = 'SPACE';
      } else {
        prefix = 'NEWLINE';
      }

    }

    if (reserved_array(current_token, ['else', 'catch', 'finally'])) {
      if ((!(this._flags.last_token.type === TOKEN.END_BLOCK && this._previous_flags.mode === MODE.BlockStatement) ||
          this._options.brace_style === "expand" ||
          this._options.brace_style === "end-expand" ||
          (this._options.brace_style === "none" && current_token.newlines)) &&
        !this._flags.inline_frame) {
        this.print_newline();
      } else {
        this._output.trim(true);
        const line = this._output.current_line;
        // If we trimmed and there's something other than a close block before us
        // put a newline back in.  Handles '} // comment' scenario.
        if (line.last() !== '}') {
          this.print_newline();
        }
        this._output.space_before_token = true;
      }
    } else if (prefix === 'NEWLINE') {
      if (reserved_array(this._flags.last_token, special_words)) {
        // no newline between 'return nnn'
        this._output.space_before_token = true;
      } else if (this._flags.last_token.text === 'declare' && reserved_array(current_token, ['var', 'let', 'const'])) {
        // accomodates Typescript declare formatting
        this._output.space_before_token = true;
      } else if (this._flags.last_token.type !== TOKEN.END_EXPR) {
        if ((this._flags.last_token.type !== TOKEN.START_EXPR || !reserved_array(current_token, ['var', 'let', 'const'])) && this._flags.last_token.text !== ':') {
          // no need to force newline on 'var': for (var x = 0...)
          if (reserved_word(current_token, 'if') && reserved_word(current_token.previous, 'else')) {
            // no newline for } else if {
            this._output.space_before_token = true;
          } else {
            this.print_newline();
          }
        }
      } else if (reserved_array(current_token, line_starters) && this._flags.last_token.text !== ')') {
        this.print_newline();
      }
    } else if (this._flags.multiline_frame && is_array(this._flags.mode) && this._flags.last_token.text === ',' && this._last_last_text === '}') {
      this.print_newline(); // }, in lists get a newline treatment
    } else if (prefix === 'SPACE') {
      this._output.space_before_token = true;
    }
    if (current_token.previous && (current_token.previous.type === TOKEN.WORD || current_token.previous.type === TOKEN.RESERVED)) {
      this._output.space_before_token = true;
    }
    this.print_token(current_token);
    this._flags.last_word = current_token.text;

    if (current_token.type === TOKEN.RESERVED) {
      if (current_token.text === 'do') {
        this._flags.do_block = true;
      } else if (current_token.text === 'if') {
        this._flags.if_block = true;
      } else if (current_token.text === 'import') {
        this._flags.import_block = true;
      } else if (this._flags.import_block && reserved_word(current_token, 'from')) {
        this._flags.import_block = false;
      }
    }
  }

  handle_semicolon(current_token) {
    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
      // Semicolon can be the start (and end) of a statement
      this._output.space_before_token = false;
    } else {
      this.handle_whitespace_and_comments(current_token);
    }

    const next_token = this._tokens.peek();
    while (this._flags.mode === MODE.Statement &&
      !(this._flags.if_block && reserved_word(next_token, 'else')) &&
      !this._flags.do_block) {
      this.restore_mode();
    }

    // hacky but effective for the moment
    if (this._flags.import_block) {
      this._flags.import_block = false;
    }
    this.print_token(current_token);
  }

  handle_string(current_token) {
    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
      // One difference - strings want at least a space before
      this._output.space_before_token = true;
    } else {
      this.handle_whitespace_and_comments(current_token);
      if (this._flags.last_token.type === TOKEN.RESERVED || this._flags.last_token.type === TOKEN.WORD || this._flags.inline_frame) {
        this._output.space_before_token = true;
      } else if (this._flags.last_token.type === TOKEN.COMMA || this._flags.last_token.type === TOKEN.START_EXPR || this._flags.last_token.type === TOKEN.EQUALS || this._flags.last_token.type === TOKEN.OPERATOR) {
        if (!this.start_of_object_property()) {
          this.allow_wrap_or_preserved_newline(current_token);
        }
      } else {
        this.print_newline();
      }
    }
    this.print_token(current_token);
  }

  handle_equals(current_token) {
    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
    } else {
      this.handle_whitespace_and_comments(current_token);
    }

    if (this._flags.declaration_statement) {
      // just got an '=' in a var-line, different formatting/line-breaking, etc will now be done
      this._flags.declaration_assignment = true;
    }
    this._output.space_before_token = true;
    this.print_token(current_token);
    this._output.space_before_token = true;
  }

  handle_comma(current_token) {
    this.handle_whitespace_and_comments(current_token, true);

    this.print_token(current_token);
    this._output.space_before_token = true;
    if (this._flags.declaration_statement) {
      if (is_expression(this._flags.parent.mode)) {
        // do not break on comma, for(var a = 1, b = 2)
        this._flags.declaration_assignment = false;
      }

      if (this._flags.declaration_assignment) {
        this._flags.declaration_assignment = false;
        this.print_newline(false, true);
      } else if (this._options.comma_first) {
        // for comma-first, we want to allow a newline before the comma
        // to turn into a newline after the comma, which we will fixup later
        this.allow_wrap_or_preserved_newline(current_token);
      }
    } else if (this._flags.mode === MODE.ObjectLiteral ||
      (this._flags.mode === MODE.Statement && this._flags.parent.mode === MODE.ObjectLiteral)) {
      if (this._flags.mode === MODE.Statement) {
        this.restore_mode();
      }

      if (!this._flags.inline_frame) {
        this.print_newline();
      }
    } else if (this._options.comma_first) {
      // EXPR or DO_BLOCK
      // for comma-first, we want to allow a newline before the comma
      // to turn into a newline after the comma, which we will fixup later
      this.allow_wrap_or_preserved_newline(current_token);
    }
  }

  handle_operator(current_token) {
    const isGeneratorAsterisk = current_token.text === '*' &&
      (reserved_array(this._flags.last_token, ['function', 'yield']) ||
        (in_array(this._flags.last_token.type, [TOKEN.START_BLOCK, TOKEN.COMMA, TOKEN.END_BLOCK, TOKEN.SEMICOLON]))
      );
    const isUnary = in_array(current_token.text, ['-', '+']) && (
      in_array(this._flags.last_token.type, [TOKEN.START_BLOCK, TOKEN.START_EXPR, TOKEN.EQUALS, TOKEN.OPERATOR]) ||
      in_array(this._flags.last_token.text, line_starters) ||
      this._flags.last_token.text === ','
    );

    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
    } else {
      const preserve_statement_flags = !isGeneratorAsterisk;
      this.handle_whitespace_and_comments(current_token, preserve_statement_flags);
    }

    if (reserved_array(this._flags.last_token, special_words)) {
      // "return" had a special handling in TK_WORD. Now we need to return the favor
      this._output.space_before_token = true;
      this.print_token(current_token);
      return;
    }

    // hack for actionscript's import .*;
    if (current_token.text === '*' && this._flags.last_token.type === TOKEN.DOT) {
      this.print_token(current_token);
      return;
    }

    if (current_token.text === '::') {
      // no spaces around exotic namespacing syntax operator
      this.print_token(current_token);
      return;
    }

    // Allow line wrapping between operators when operator_position is
    //   set to before or preserve
    if (this._flags.last_token.type === TOKEN.OPERATOR && in_array(this._options.operator_position, OPERATOR_POSITION_BEFORE_OR_PRESERVE)) {
      this.allow_wrap_or_preserved_newline(current_token);
    }

    if (current_token.text === ':' && this._flags.in_case) {
      this._flags.case_body = true;
      this.indent();
      this.print_token(current_token);
      this.print_newline();
      this._flags.in_case = false;
      return;
    }

    let space_before = true;
    let space_after = true;
    let in_ternary = false;
    if (current_token.text === ':') {
      if (this._flags.ternary_depth === 0) {
        // Colon is invalid javascript outside of ternary and object, but do our best to guess what was meant.
        space_before = false;
      } else {
        this._flags.ternary_depth -= 1;
        in_ternary = true;
      }
    } else if (current_token.text === '?') {
      this._flags.ternary_depth += 1;
    }

    // let's handle the operator_position option prior to any conflicting logic
    if (!isUnary && !isGeneratorAsterisk && this._options.preserve_newlines && in_array(current_token.text, positionable_operators)) {
      const isColon = current_token.text === ':';
      const isTernaryColon = (isColon && in_ternary);
      const isOtherColon = (isColon && !in_ternary);

      switch (this._options.operator_position) {
        case OPERATOR_POSITION.before_newline:
          // if the current token is : and it's not a ternary statement then we set space_before to false
          this._output.space_before_token = !isOtherColon;

          this.print_token(current_token);

          if (!isColon || isTernaryColon) {
            this.allow_wrap_or_preserved_newline(current_token);
          }

          this._output.space_before_token = true;
          return;

        case OPERATOR_POSITION.after_newline:
          // if the current token is anything but colon, or (via deduction) it's a colon and in a ternary statement,
          //   then print a newline.

          this._output.space_before_token = true;

          if (!isColon || isTernaryColon) {
            if (this._tokens.peek().newlines) {
              this.print_newline(false, true);
            } else {
              this.allow_wrap_or_preserved_newline(current_token);
            }
          } else {
            this._output.space_before_token = false;
          }

          this.print_token(current_token);

          this._output.space_before_token = true;
          return;

        case OPERATOR_POSITION.preserve_newline:
          if (!isOtherColon) {
            this.allow_wrap_or_preserved_newline(current_token);
          }

          // if we just added a newline, or the current token is : and it's not a ternary statement,
          //   then we set space_before to false
          space_before = !(this._output.just_added_newline() || isOtherColon);

          this._output.space_before_token = space_before;
          this.print_token(current_token);
          this._output.space_before_token = true;
          return;
      }
    }

    if (isGeneratorAsterisk) {
      this.allow_wrap_or_preserved_newline(current_token);
      space_before = false;
      const next_token = this._tokens.peek();
      space_after = next_token && in_array(next_token.type, [TOKEN.WORD, TOKEN.RESERVED]);
    } else if (current_token.text === '...') {
      this.allow_wrap_or_preserved_newline(current_token);
      space_before = this._flags.last_token.type === TOKEN.START_BLOCK;
      space_after = false;
    } else if (in_array(current_token.text, ['--', '++', '!', '~']) || isUnary) {
      // unary operators (and binary +/- pretending to be unary) special cases
      if (this._flags.last_token.type === TOKEN.COMMA || this._flags.last_token.type === TOKEN.START_EXPR) {
        this.allow_wrap_or_preserved_newline(current_token);
      }

      space_before = false;
      space_after = false;

      // http://www.ecma-international.org/ecma-262/5.1/#sec-7.9.1
      // if there is a newline between -- or ++ and anything else we should preserve it.
      if (current_token.newlines && (current_token.text === '--' || current_token.text === '++')) {
        this.print_newline(false, true);
      }

      if (this._flags.last_token.text === ';' && is_expression(this._flags.mode)) {
        // for (;; ++i)
        //        ^^^
        space_before = true;
      }

      if (this._flags.last_token.type === TOKEN.RESERVED) {
        space_before = true;
      } else if (this._flags.last_token.type === TOKEN.END_EXPR) {
        space_before = !(this._flags.last_token.text === ']' && (current_token.text === '--' || current_token.text === '++'));
      } else if (this._flags.last_token.type === TOKEN.OPERATOR) {
        // a++ + ++b;
        // a - -b
        space_before = in_array(current_token.text, ['--', '-', '++', '+']) && in_array(this._flags.last_token.text, ['--', '-', '++', '+']);
        // + and - are not unary when preceeded by -- or ++ operator
        // a-- + b
        // a * +b
        // a - -b
        if (in_array(current_token.text, ['+', '-']) && in_array(this._flags.last_token.text, ['--', '++'])) {
          space_after = true;
        }
      }


      if (((this._flags.mode === MODE.BlockStatement && !this._flags.inline_frame) || this._flags.mode === MODE.Statement) &&
        (this._flags.last_token.text === '{' || this._flags.last_token.text === ';')) {
        // { foo; --i }
        // foo(); --bar;
        this.print_newline();
      }
    }

    this._output.space_before_token = this._output.space_before_token || space_before;
    this.print_token(current_token);
    this._output.space_before_token = space_after;
  }

  handle_block_comment(current_token, preserve_statement_flags) {
    if (this._output.raw) {
      this._output.add_raw_token(current_token);
      if (current_token.directives && current_token.directives.preserve === 'end') {
        // If we're testing the raw output behavior, do not allow a directive to turn it off.
        this._output.raw = this._options.test_output_raw;
      }
      return;
    }

    if (current_token.directives) {
      this.print_newline(false, preserve_statement_flags);
      this.print_token(current_token);
      if (current_token.directives.preserve === 'start') {
        this._output.raw = true;
      }
      this.print_newline(false, true);
      return;
    }

    // inline block
    if (!acorn.newline.test(current_token.text) && !current_token.newlines) {
      this._output.space_before_token = true;
      this.print_token(current_token);
      this._output.space_before_token = true;
      return;
    }

    let lines = split_linebreaks(current_token.text);
    let j; // iterator for this case
    let javadoc = false;
    let starless = false;
    const lastIndent = current_token.whitespace_before;
    const lastIndentLength = lastIndent.length;

    // block comment starts with a new line
    this.print_newline(false, preserve_statement_flags);

    // first line always indented
    this.print_token(current_token, lines[0]);
    this.print_newline(false, preserve_statement_flags);


    if (lines.length > 1) {
      lines = lines.slice(1);
      javadoc = all_lines_start_with(lines, '*');
      starless = each_line_matches_indent(lines, lastIndent);

      if (javadoc) {
        this._flags.alignment = 1;
      }

      for (j = 0; j < lines.length; j++) {
        if (javadoc) {
          // javadoc: reformat and re-indent
          this.print_token(current_token, ltrim(lines[j]));
        } else if (starless && lines[j]) {
          // starless: re-indent non-empty content, avoiding trim
          this.print_token(current_token, lines[j].substring(lastIndentLength));
        } else {
          // normal comments output raw
          this._output.current_line.set_indent(-1);
          this._output.add_token(lines[j]);
        }

        // for comments on their own line or  more than one line, make sure there's a new line after
        this.print_newline(false, preserve_statement_flags);
      }

      this._flags.alignment = 0;
    }
  }

  handle_comment(current_token, preserve_statement_flags) {
    if (current_token.newlines) {
      this.print_newline(false, preserve_statement_flags);
    } else {
      this._output.trim(true);
    }

    this._output.space_before_token = true;
    this.print_token(current_token);
    this.print_newline(false, preserve_statement_flags);
  }

  handle_dot(current_token) {
    if (this.start_of_statement(current_token)) {
      // The conditional starts the statement if appropriate.
    } else {
      this.handle_whitespace_and_comments(current_token, true);
    }

    if (reserved_array(this._flags.last_token, special_words)) {
      this._output.space_before_token = false;
    } else {
      // allow preserved newlines before dots in general
      // force newlines on dots after close paren when break_chained - for bar().baz()
      this.allow_wrap_or_preserved_newline(current_token,
        this._flags.last_token.text === ')' && this._options.break_chained_methods);
    }

    // Only unindent chained method dot if this dot starts a new line.
    // Otherwise the automatic extra indentation removal will handle the over indent
    if (this._options.unindent_chained_methods && this._output.just_added_newline()) {
      this.deindent();
    }

    this.print_token(current_token);
  }

  handle_unknown(current_token, preserve_statement_flags) {
    this.print_token(current_token);

    if (current_token.text[current_token.text.length - 1] === '\n') {
      this.print_newline(false, preserve_statement_flags);
    }
  }

  handle_eof(current_token) {
    // Unwind any open statements
    while (this._flags.mode === MODE.Statement) {
      this.restore_mode();
    }
    this.handle_whitespace_and_comments(current_token);
  }
}

const newline_restricted_tokens = ['async', 'break', 'continue', 'return', 'throw', 'yield'];







//
const tokenizer1=new Tokenizerx("var a='1';\n b = 2", {});
_tokens1=tokenizer1.tokenize();
//
console.dir(_tokens1);

for(item of _tokens1.__tokens){
		console.dir(item);
}
/*
    let current_token = _tokens1.__tokens[0];
    while (current_token) {
		console.dir(current_token);
      current_token = current_token.next();
    }
*/