//+------------------------------------------------------------------+
//|                                                     ToptierBridge |
//|             MT4 <-> TOPTIER bot service file bridge (EA)         |
//|                                                                  |
//|  MetaTrader 4 has no official Python API, so this Expert Advisor |
//|  runs inside the MT4 terminal and executes commands that the     |
//|  TOPTIER bot service sends as files in the terminal's Files      |
//|  folder (MQL4\Files\). Protocol:                                 |
//|                                                                  |
//|    tb_cmd.cmd   Python -> EA   one line:  CMD|<id>|<cmd>|<args> |
//|    tb_resp.cmd  EA -> Python   one line:  OK|<id>|<data...>      |
//|                                  or       ERR|<id>|<message>    |
//|                                                                  |
//|  The EA polls for tb_cmd.cmd every EA_POLL_MS and replies as     |
//|  fast as it can. Attach this EA to ANY chart (one instance per   |
//|  terminal - it drives the whole terminal, not just one symbol).  |
//+------------------------------------------------------------------+
#property copyright "TOPTIER"
#property version   "1.00"
#property strict

input string  BridgeFileNameCmd    = "tb_cmd.cmd";    // command file (in MQL4\Files\)
input string  BridgeFileNameResp   = "tb_resp.cmd";   // response file (in MQL4\Files\)
input int     EA_POLL_MS           = 300;             // command poll interval
input int     SlippagePoints       = 10;              // order slippage (points)
input color   OrderColor           = clrDodgerBlue;   // arrows drawn for placed orders

string  g_lastCmd;   // last command id
int     g_pollMs;

//+------------------------------------------------------------------+
//| Helper: split a string on a single-char delimiter                |
//+------------------------------------------------------------------+
void SplitString(string input, string delim, string &out[], int maxParts)
{
   int count = 0;
   string buffer = input;
   int pos;
   ArrayResize(out, 0);
   while (count < maxParts)
   {
      pos = StringFind(buffer, delim);
      if (pos < 0)
         break;
      count++;
      ArrayResize(out, count);
      out[count - 1] = StringSubstr(buffer, 0, pos);
      buffer = StringSubstr(buffer, pos + 1);
   }
   if (count < maxParts)
   {
      count++;
      ArrayResize(out, count);
      out[count - 1] = buffer;
   }
}

//+------------------------------------------------------------------+
//| Write the response file                                          |
//+------------------------------------------------------------------+
void Respond(string response)
{
   int h = FileOpen(BridgeFileNameResp, FILE_WRITE | FILE_TXT);
   if (h < 0)
      return;
   FileWriteString(h, response);
   FileFlush(h);
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Common helpers                                                   |
//+------------------------------------------------------------------+
string AccountInfoResponse()
{
   string s = "OK|" + g_lastCmd + "|";
   s += (string)AccountNumber() + "|";
   s += DoubleToStr(AccountBalance(), 2) + "|";
   s += DoubleToStr(AccountEquity(), 2) + "|";
   s += AccountCurrency() + "|";
   s += AccountServer() + "|";
   s += (string)AccountLeverage();
   return s;
}

string SymbolInfoResponse(string symbol)
{
   if (MarketInfo(symbol, MODE_BID) == 0.0 && MarketInfo(symbol, MODE_ASK) == 0.0)
      return "ERR|" + g_lastCmd + "|Unknown symbol: " + symbol;
   string s = "OK|" + g_lastCmd + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_POINT), 8) + "|";
   s += (string)(int)MarketInfo(symbol, MODE_DIGITS) + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_MINLOT), 2) + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_LOTSTEP), 2) + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_SPREAD), 1) + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_BID), MarketInfo(symbol, MODE_DIGITS)) + "|";
   s += DoubleToStr(MarketInfo(symbol, MODE_ASK), MarketInfo(symbol, MODE_DIGITS));
   return s;
}

//+------------------------------------------------------------------+
//| Rates: n most recent bars, oldest first (matches MT5 connector)  |
//+------------------------------------------------------------------+
string RatesResponse(string symbol, int tfMinutes, int nBars)
{
   int tf;
   if (tfMinutes == 1)       tf = PERIOD_M1;
   else if (tfMinutes == 5)  tf = PERIOD_M5;
   else if (tfMinutes == 15) tf = PERIOD_M15;
   else if (tfMinutes == 30) tf = PERIOD_M30;
   else if (tfMinutes == 60) tf = PERIOD_H1;
   else if (tfMinutes == 240)tf = PERIOD_H4;
   else if (tfMinutes == 1440)tf = PERIOD_D1;
   else return "ERR|" + g_lastCmd + "|Unknown timeframe";

   int available = Bars(symbol, tf);
   if (available < 2)
      return "ERR|" + g_lastCmd + "|No data for " + symbol;

   if (nBars > available - 1)
      nBars = available - 1;

   string s = "OK|" + g_lastCmd;
   // index 0 = newest bar; emit oldest first so the engine sees ascending time.
   for (int i = nBars - 1; i >= 0; i--)
   {
      s += "|";
      s += (string)iTime(symbol, tf, i) + ",";
      s += DoubleToStr(iOpen(symbol, tf, i), 8) + ",";
      s += DoubleToStr(iHigh(symbol, tf, i), 8) + ",";
      s += DoubleToStr(iLow(symbol, tf, i), 8) + ",";
      s += DoubleToStr(iClose(symbol, tf, i), 8) + ",";
      s += (string)(int)iVolume(symbol, tf, i);
   }
   return s;
}

//+------------------------------------------------------------------+
//| Order placement                                                  |
//+------------------------------------------------------------------+
string OrderResponse(string symbol, string direction, string lotsStr,
                     string slStr, string tpStr, string comment, string magicStr)
{
   double lots  = StrToDouble(lotsStr);
   double sl    = StrToDouble(slStr);
   double tp    = StrToDouble(tpStr);
   int    magic = StrToInteger(magicStr);

   double lotStep = MarketInfo(symbol, MODE_LOTSTEP);
   if (lotStep > 0.0)
      lots = NormalizeDouble(lots / lotStep, 0) * lotStep;
   double minLot = MarketInfo(symbol, MODE_MINLOT);
   if (lots < minLot)
      lots = minLot;

   int cmd = (direction == "SELL") ? OP_SELL : OP_BUY;
   double price = (cmd == OP_BUY) ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);
   if (price == 0.0)
      return "ERR|" + g_lastCmd + "|No price for " + symbol;

   if (sl != 0.0) sl = NormalizeDouble(sl, MarketInfo(symbol, MODE_DIGITS));
   if (tp != 0.0) tp = NormalizeDouble(tp, MarketInfo(symbol, MODE_DIGITS));

   int ticket = OrderSend(symbol, cmd, lots, price, SlippagePoints, sl, tp, comment, magic, 0, OrderColor);
   if (ticket < 0)
      return "ERR|" + g_lastCmd + "|OrderSend failed: " + (string)GetLastError();

   return "OK|" + g_lastCmd + "|" + (string)ticket + "|" + DoubleToStr(price, MarketInfo(symbol, MODE_DIGITS));
}

//+------------------------------------------------------------------+
//| Modify / close                                                   |
//+------------------------------------------------------------------+
string ModifyResponse(string ticketStr, string slStr, string tpStr)
{
   int ticket = StrToInteger(ticketStr);
   if (!OrderSelect(ticket, SELECT_BY_TICKET))
      return "ERR|" + g_lastCmd + "|No order " + ticketStr;

   double sl = StrToDouble(slStr);
   double tp = StrToDouble(tpStr);
   if (OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE))
      return "OK|" + g_lastCmd + "|" + ticketStr;
   return "ERR|" + g_lastCmd + "|OrderModify failed: " + (string)GetLastError();
}

string CloseResponse(string ticketStr, string symbol, string volumeStr)
{
   int ticket = StrToInteger(ticketStr);
   if (!OrderSelect(ticket, SELECT_BY_TICKET))
      return "ERR|" + g_lastCmd + "|No order " + ticketStr;

   double closeLots = OrderLots();
   if (StringLen(volumeStr) > 0 && StrToDouble(volumeStr) > 0.0)
      closeLots = StrToDouble(volumeStr);

   bool isBuy = (OrderType() == OP_BUY);
   double price = isBuy ? MarketInfo(OrderSymbol(), MODE_BID) : MarketInfo(OrderSymbol(), MODE_ASK);
   int digits  = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
   price = NormalizeDouble(price, digits);

   if (OrderClose(ticket, closeLots, price, SlippagePoints, clrRed))
      return "OK|" + g_lastCmd + "|" + ticketStr + "|" + DoubleToStr(price, digits);
   return "ERR|" + g_lastCmd + "|OrderClose failed: " + (string)GetLastError();
}

//+------------------------------------------------------------------+
//| Positions: ticket,symbol,type,lots,entry,sl,tp,profit,time       |
//+------------------------------------------------------------------+
string PositionsResponse()
{
   string s = "OK|" + g_lastCmd;
   for (int i = 0; i < OrdersTotal(); i++)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      s += "|";
      s += (string)OrderTicket() + ",";
      s += OrderSymbol() + ",";
      s += (string)OrderType() + ",";
      s += DoubleToStr(OrderLots(), 2) + ",";
      s += DoubleToStr(OrderOpenPrice(), MarketInfo(OrderSymbol(), MODE_DIGITS)) + ",";
      s += DoubleToStr(OrderStopLoss(), 8) + ",";
      s += DoubleToStr(OrderTakeProfit(), 8) + ",";
      s += DoubleToStr(OrderProfit(), 2) + ",";
      s += (string)OrderOpenTime() + ",";
      s += OrderComment() + ",";
      s += (string)OrderMagicNumber();
   }
   return s;
}

//+------------------------------------------------------------------+
//| Closing deals since epoch: ticket,position_id,entry,profit,price |
//| time,magic,symbol (entry=1 OUT only)                             |
//+------------------------------------------------------------------+
string DealsResponse(string sinceStr)
{
   datetime from = StrToInteger(sinceStr);
   if (!HistorySelect(from, TimeCurrent()))
      return "OK|" + g_lastCmd; // empty

   string s = "OK|" + g_lastCmd;
   int total = HistoryDealsTotal();
   for (int i = 0; i < total; i++)
   {
      int ticket = HistoryDealGetTicket(i);
      if (ticket <= 0)
         continue;
      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if (entry != DEAL_ENTRY_OUT)
         continue;

      long posId = HistoryDealGetInteger(ticket, DEAL_ORDER); // position/order ticket
      if (posId == 0)
         posId = ticket;

      s += "|";
      s += (string)ticket + ",";
      s += (string)posId + ",";
      s += (string)entry + ",";
      s += DoubleToStr(HistoryDealGetDouble(ticket, DEAL_PROFIT), 2) + ",";
      s += DoubleToStr(HistoryDealGetDouble(ticket, DEAL_PRICE), 8) + ",";
      s += (string)HistoryDealGetInteger(ticket, DEAL_TIME) + ",";
      s += (string)HistoryDealGetInteger(ticket, DEAL_MAGIC) + ",";
      s += HistoryDealGetString(ticket, DEAL_SYMBOL);
   }
   return s;
}

//+------------------------------------------------------------------+
//| Dispatch a parsed command                                        |
//+------------------------------------------------------------------+
void Dispatch(string parts[])
{
   int n = ArraySize(parts);
   if (n < 3)
   {
      Respond("ERR|" + g_lastCmd + "|Malformed command");
      return;
   }
   string cmd = parts[2];

   if      (cmd == "PING")      Respond("OK|" + g_lastCmd + "|PONG");
   else if (cmd == "INFO")      Respond(AccountInfoResponse());
   else if (cmd == "SYMBOL" && n >= 4)   Respond(SymbolInfoResponse(parts[3]));
   else if (cmd == "RATES" && n >= 6)    Respond(RatesResponse(parts[3], StrToInteger(parts[4]), StrToInteger(parts[5])));
   else if (cmd == "SPREAD" && n >= 4)
   {
      double sp = MarketInfo(parts[3], MODE_SPREAD);
      if (sp > 0.0) Respond("OK|" + g_lastCmd + "|" + DoubleToStr(sp, 1));
      else          Respond("ERR|" + g_lastCmd + "|No symbol " + parts[3]);
   }
   else if (cmd == "ORDER" && n >= 10)
      Respond(OrderResponse(parts[3], parts[4], parts[5], parts[6], parts[7], parts[8], parts[9]));
   else if (cmd == "MODIFY" && n >= 5)   Respond(ModifyResponse(parts[3], parts[4], parts[5]));
   else if (cmd == "CLOSE" && n >= 4)
   {
      string vol = (n >= 6) ? parts[5] : "";
      Respond(CloseResponse(parts[3], (n >= 5) ? parts[4] : "", vol));
   }
   else if (cmd == "POSITIONS") Respond(PositionsResponse());
   else if (cmd == "DEALS" && n >= 4)    Respond(DealsResponse(parts[3]));
   else Respond("ERR|" + g_lastCmd + "|Unknown command: " + cmd);
}

//+------------------------------------------------------------------+
//| Timer: poll for a command file                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   if (!FileIsExist(BridgeFileNameCmd))
      return;

   int h = FileOpen(BridgeFileNameCmd, FILE_READ | FILE_TXT);
   if (h < 0)
   {
      FileDelete(BridgeFileNameCmd);
      return;
   }

   string line = "";
   while (!FileIsEnding(h))
      line += FileReadString(h);
   FileClose(h);
   FileDelete(BridgeFileNameCmd);

   if (StringLen(line) == 0)
      return;

   string parts[];
   SplitString(line, "|", parts, 16);
   if (ArraySize(parts) >= 3)
   {
      g_lastCmd = parts[1];
      Dispatch(parts);
   }
}

//+------------------------------------------------------------------+
//| EA lifecycle                                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   g_pollMs = (EA_POLL_MS < 100) ? 100 : EA_POLL_MS;
   EventSetMillisecondTimer(g_pollMs);
   Print("ToptierBridge online: polling for commands every ", g_pollMs, "ms");
   return (INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   // Polling handled in OnTimer - nothing to do per tick.
}
//+------------------------------------------------------------------+
