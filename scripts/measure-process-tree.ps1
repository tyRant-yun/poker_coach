param([int]$RootPid,[string]$Output,[string]$StopFile)
$ErrorActionPreference='Stop';$peak=0L;$samples=0;$maxCount=0
while(-not(Test-Path -LiteralPath $StopFile)){
  $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize
  $ids=[Collections.Generic.HashSet[int]]::new();$null=$ids.Add($RootPid)
  do{$added=$false;foreach($p in $all){if($p.ProcessId -ne $PID -and $ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added)
  $sum=0L;foreach($p in $all){if($ids.Contains([int]$p.ProcessId)){$sum += [long]$p.WorkingSetSize}}
  $peak=[Math]::Max($peak,$sum);$maxCount=[Math]::Max($maxCount,$ids.Count);$samples++;Start-Sleep -Milliseconds 50
}
[IO.File]::WriteAllText($Output,([ordered]@{method='Win32_Process current WorkingSetSize sum across root and descendant processes, excluding observer; 50ms sleep plus CIM overhead; observed aggregate peak, not per-process maxima added';samples=$samples;peakBytes=$peak;maxProcesses=$maxCount}|ConvertTo-Json))
